/**
 * publish-static.js
 * ECS publish-task entrypoint for the lean Deployments feature
 * (run as `node scripts/publish-static.js` from the repo root, in the same
 * image as the admin app — PR 11 provisions the task definition).
 *
 * Driven by environment:
 *   DEPLOYMENT_ID     - the deployments row to publish (required)
 *   DEPLOYMENT_ACTION - "publish" (default) creates the CloudFormation
 *                       stack first; "update" reuses the existing stack
 *                       and just re-bakes + re-uploads (same URL).
 *
 * Flow: read the mission config from Postgres → apply bake guards → bake
 * via bakeStaticConfig → build themes + static webpack bundle
 * (SERVER=static STATIC_MODE=true) → CreateStack + poll to CREATE_COMPLETE
 * (publish only) → same-key copy the mission's assets from the shared
 * admin bucket → upload the bundle → mark the row `published`.
 * Any failure marks the row `failed` with last_error.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");

const provision = require("./lib/aws-provision");
const { renderCfnTemplate, stackNameForDeployment } = require("./lib/cfn-template");
const { applyTimeBakeGuard } = require("./lib/bake-guards");

const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID || process.argv[2];
const ACTION = process.env.DEPLOYMENT_ACTION || process.argv[3] || "publish";

const { requireEnv } = provision;

function log(message) {
  console.log(`[publish-static] ${message}`);
}

// Runs an npm script synchronously from the repo root; throws on failure.
function run(command, args, extraEnv) {
  log(`Running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...(extraEnv || {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `'${command} ${args.join(" ")}' exited with code ${result.status}`
    );
}

// Builds the baked static config object (keyed by call name — see
// src/pre/staticHandlers.js) from the mission's latest configuration.
async function buildBakedConfig(mission) {
  const Config = require("../API/Backend/Config/models/config");
  const GeneralOptions = require("../API/Backend/GeneralOptions/models/generaloptions");

  const entry = await Config.findOne({
    where: { mission },
    order: [["version", "DESC"]],
  });
  if (entry == null)
    throw new Error(`Mission '${mission}' not found in the configs table`);

  const config = JSON.parse(JSON.stringify(entry.config));
  // Match /api/configure/get's missionFolderName fallback
  if (
    config.msv &&
    (config.msv.missionFolderName == null ||
      config.msv.missionFolderName === "")
  )
    config.msv.missionFolderName = config.msv.mission || "";

  // Gate-by-default: don't ship a time scrubber that goes nowhere
  applyTimeBakeGuard(config);

  let options = {};
  try {
    const generalOptions = await GeneralOptions.findOne({ where: { id: 1 } });
    if (generalOptions != null && generalOptions.options != null)
      options = generalOptions.options;
  } catch (err) {
    log(`No general options found (${err.message}); baking empty options.`);
  }

  return {
    get: config,
    missions: { status: "success", missions: [mission] },
    get_generaloptions: { status: "success", options },
  };
}

async function main() {
  if (DEPLOYMENT_ID == null || DEPLOYMENT_ID === "")
    throw new Error("DEPLOYMENT_ID is required (env or first argument)");
  if (ACTION !== "publish" && ACTION !== "update")
    throw new Error(`Unknown DEPLOYMENT_ACTION '${ACTION}'`);

  const Deployments = require("../API/Backend/Deployments/models/deployment");
  const deployment = await Deployments.findByPk(DEPLOYMENT_ID);
  if (deployment == null)
    throw new Error(`Deployment row ${DEPLOYMENT_ID} not found`);

  try {
    const mission = deployment.mission;
    const stackName =
      deployment.stack_name || stackNameForDeployment(deployment.id);

    // 1. Bake the mission config into the bundle
    log(`Baking mission '${mission}' for deployment ${deployment.id}...`);
    const baked = await buildBakedConfig(mission);
    const { bakeStaticConfig } = require("../API/updateTools");
    bakeStaticConfig(baked);

    // 2. Build the static bundle. Theme assets (dist/) are baked into the
    // image at image-build time (deploy-lean.yml runs build:themes before
    // docker build), and build-assets.sh needs tools absent from the slim
    // runtime image (rsync) — so only build themes when they're missing.
    const distDir = path.join(__dirname, "..", "dist");
    if (fs.existsSync(distDir) && fs.readdirSync(distDir).length > 0) {
      log("Theme assets already present (dist/), skipping build:themes.");
    } else {
      run("npm", ["run", "build:themes"]);
    }
    run("npm", ["run", "build"], {
      SERVER: "static",
      STATIC_MODE: "true",
    });

    // 3. Provision (publish) or look up (update) the dashboard stack
    let stack;
    if (ACTION === "publish") {
      // Idempotent re-run: a previous attempt may have created the stack
      // and failed later (e.g. mid-upload) — reuse it instead of dying on
      // CloudFormation's AlreadyExistsException.
      const existing = await provision.describeStack({ stackName });
      if (existing == null) {
        const templateBody = renderCfnTemplate({
          password: requireEnv("MMGIS_DASHBOARDS_PASSWORD"),
        });
        log(`Creating stack '${stackName}'...`);
        await provision.createStack({ stackName, templateBody });
      } else {
        log(
          `Stack '${stackName}' already exists (${existing.StackStatus}); skipping CreateStack.`
        );
      }
      stack = await provision.waitForStack({ stackName });
      log(`Stack '${stackName}' reached ${stack.StackStatus}.`);
    } else {
      stack = await provision.describeStack({ stackName });
      if (stack == null)
        throw new Error(
          `Stack '${stackName}' does not exist — publish before updating`
        );
    }
    const outputs = provision.getStackOutputs(stack);
    const bucket = outputs.BucketName;
    if (bucket == null)
      throw new Error(`Stack '${stackName}' has no BucketName output`);

    // 4. Same-key copy the mission's assets from the shared admin bucket
    //    so root-relative /assets/<mission>/… references resolve
    //    same-origin against the dashboard's CloudFront. Copied assets
    //    inherit the dashboard's password gate as ordinary bundle content.
    const sharedBucket = process.env.MMGIS_SHARED_ASSET_BUCKET;
    if (sharedBucket != null && sharedBucket !== "") {
      const copied = await provision.copyPrefix({
        sourceBucket: sharedBucket,
        destBucket: bucket,
        prefix: `assets/${mission}/`,
      });
      log(`Copied ${copied} mission asset(s) from ${sharedBucket}.`);

      // Viewer-panel mosaic file (conditional): the Photosphere/ModelViewer
      // panes fetch this hardcoded same-origin path. Copy it when present;
      // when absent the panes fail silently rather than erroring.
      const mosaicKey = `Missions/${mission}/Data/mosaic_parameters.csv`;
      const mosaicCopied = await provision.copyObjectIfExists({
        sourceBucket: sharedBucket,
        destBucket: bucket,
        key: mosaicKey,
      });
      if (mosaicCopied) log(`Copied ${mosaicKey}.`);
    } else {
      log("MMGIS_SHARED_ASSET_BUCKET not set; skipping mission asset copy.");
    }

    // 5. Upload the bundle
    const uploaded = await provision.uploadDirectory({
      bucket,
      dir: path.join(rootDir, "build"),
    });
    log(`Uploaded ${uploaded} bundle file(s) to ${bucket}.`);

    // 6. Terminal row update
    const cloudfrontUrl =
      outputs.DistributionDomainName != null
        ? `https://${outputs.DistributionDomainName}`
        : deployment.cloudfront_url;
    await deployment.update({
      status: Deployments.STATUS.PUBLISHED,
      stack_arn: stack.StackId,
      stack_name: stackName,
      cloudfront_url: cloudfrontUrl,
      last_error: null,
      settings: {
        ...(deployment.settings || {}),
        bucket,
        distributionId: outputs.DistributionId,
      },
    });
    log(`Deployment ${deployment.id} published at ${cloudfrontUrl}.`);
  } catch (err) {
    console.error(err);
    await deployment
      .update({
        status: Deployments.STATUS.FAILED,
        last_error: err.message || String(err),
      })
      .catch(() => {});
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[publish-static] Failed: ${err.message}`);
    process.exit(1);
  });
