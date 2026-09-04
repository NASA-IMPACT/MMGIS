/**
 * publish-static.js
 * ECS publish-task entrypoint for the lean Deployments feature
 * (run as `node scripts/publish-static.js` from the repo root, in the same
 * image as the admin app; the ECS task definition that runs it lives in
 * infrastructure/terraform/modules/mmgis-environment/).
 *
 * Driven by environment:
 *   MMGIS_DEPLOYMENT_ID     - the deployments row to publish (required)
 *   MMGIS_DEPLOYMENT_ACTION - "publish" (default) creates the CloudFormation
 *                       stack when none exists yet and otherwise converges the
 *                       existing one (a previous attempt may have created it);
 *                       "update" converges the existing stack, and is refused
 *                       when the row's stack is gone (see lib/publish-flow.js).
 *                       Converging applies the current template via
 *                       UpdateStack — including re-baking the current
 *                       dashboards password into the auth Function. Both
 *                       actions then re-bake + re-upload the bundle (same URL).
 *
 * Flow: read the mission config from Postgres → apply bake guards → bake
 * via bakeStaticConfig → build themes + static webpack bundle
 * (SERVER=static) → CreateStack/UpdateStack + poll to the terminal status
 * → same-key copy the mission's assets from the shared admin bucket →
 * upload the bundle → mark the row `published`.
 * Any failure marks the row `failed` with last_error.
 */

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");

const provision = require("./lib/aws-provision");
const {
  rowStillOurs,
  rowStillOursForFailure,
  stackAction,
  assertRowLive,
} = require("./lib/publish-flow");
const { renderCfnTemplate, stackNameForDeployment } = require("./lib/cfn-template");
const { applyTimeBakeGuard } = require("./lib/bake-guards");

const DEPLOYMENT_ID = process.env.MMGIS_DEPLOYMENT_ID || process.argv[2];
const ACTION = process.env.MMGIS_DEPLOYMENT_ACTION || process.argv[3] || "publish";

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
    throw new Error("MMGIS_DEPLOYMENT_ID is required (env or first argument)");
  if (ACTION !== "publish" && ACTION !== "update")
    throw new Error(`Unknown DEPLOYMENT_ACTION '${ACTION}'`);

  const Deployments = require("../API/Backend/Deployments/models/deployment");
  const deployment = await Deployments.findByPk(DEPLOYMENT_ID);
  if (deployment == null)
    throw new Error(`Deployment row ${DEPLOYMENT_ID} not found`);

  // A Delete that overlaps a running task owns the row's status from then on,
  // so every terminal write below lands only while the row is still one this
  // task is responsible for.
  const publishedWhere = {
    id: deployment.id,
    ...rowStillOurs(Deployments.STATUS),
  };
  const failedWhere = {
    id: deployment.id,
    ...rowStillOursForFailure(Deployments.STATUS),
  };
  // The row as it stands now, for the steps that must not run on a deployment
  // a Delete has claimed while this task was baking and building.
  const readRow = () => Deployments.findByPk(deployment.id);

  try {
    const mission = deployment.mission;
    const stackName =
      deployment.stack_name || stackNameForDeployment(deployment.id);

    // A first read, purely to fail fast: an update whose stack is gone, and a
    // stack only a delete can move, both stop here in seconds rather than after
    // the multi-minute bake and build below. What gets created or converged is
    // decided by a second read taken after that build, and convergeStackUpdate
    // re-checks usability per attempt.
    const existing = await provision.describeStack({ stackName });
    const preflight = stackAction({
      action: ACTION,
      stack: existing,
      stackName,
      stackArn: deployment.stack_arn,
    });
    if (preflight.refuse) throw new Error(preflight.refuse);
    if (existing != null)
      provision.assertStackUsable({ stackName, stack: existing });

    // 1. Bake the mission config into the bundle
    log(`Baking mission '${mission}' for deployment ${deployment.id}...`);
    const baked = await buildBakedConfig(mission);
    const { bakeStaticConfig } = require("../API/updateTools");
    bakeStaticConfig(baked);

    // 2. Build the static bundle. Theme assets (dist/) are baked into the
    // image at image-build time (the deploy workflow runs build:themes before
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
    });

    // 3. Provision (publish) or converge (update) the dashboard stack
    const templateBody = renderCfnTemplate({
      password: requireEnv("MMGIS_DASHBOARDS_PASSWORD"),
    });
    let stack;
    // Which branch to take follows a read taken now, not the one from before
    // the build: another task can have created the stack in the meantime (a
    // CreateStack onto it is an AlreadyExistsException) or deleted it (a
    // converge onto it has nothing to update).
    const current = await provision.describeStack({ stackName });
    const action = stackAction({
      action: ACTION,
      stack: current,
      stackName,
      stackArn: deployment.stack_arn,
    });
    if (action.refuse) throw new Error(action.refuse);
    // Provisioning is the point of no return for a Delete that landed during
    // the build: past it, a stack exists whose teardown nobody is running.
    assertRowLive(await readRow(), Deployments.STATUS);
    if (action === "create") {
      log(`Creating stack '${stackName}'...`);
      await provision.createStack({ stackName, templateBody });
      stack = await provision.waitForStack({ stackName });
    } else {
      stack = await provision.convergeStackUpdate({
        stackName,
        templateBody,
        fresh: current,
        log,
      });
    }
    log(`Stack '${stackName}' is at ${stack.StackStatus}.`);
    const outputs = provision.getStackOutputs(stack);
    const bucket = outputs.BucketName;
    if (bucket == null)
      throw new Error(`Stack '${stackName}' has no BucketName output`);

    // A delete can also have started during the stack wait, which is the
    // longest step of all; filling the bucket it is about to empty only slows
    // the teardown down. Everything below writes into that bucket.
    assertRowLive(await readRow(), Deployments.STATUS);

    // 4. Same-key copy the mission's assets from the shared admin bucket
    //    so document-relative assets/<mission>/… references resolve
    //    against the dashboard's document base (the customer prefix,
    //    when one is configured, included). Copied assets inherit the
    //    dashboard's password gate as ordinary bundle content.
    const sharedBucket = process.env.MMGIS_SHARED_ASSET_BUCKET;
    if (sharedBucket != null && sharedBucket !== "") {
      // Uploads are keyed by the mission's FOLDER name (msv.missionFolderName,
      // falling back to msv.mission — the same name the full-mode disk path
      // uses), not the registry name. The bake already normalized it.
      const missionFolderName =
        (baked.get.msv && baked.get.msv.missionFolderName) || mission;
      const copied = await provision.copyPrefix({
        sourceBucket: sharedBucket,
        destBucket: bucket,
        prefix: `assets/${missionFolderName}/`,
      });
      log(`Copied ${copied} mission asset(s) from ${sharedBucket}.`);
    } else {
      log("MMGIS_SHARED_ASSET_BUCKET not set; skipping mission asset copy.");
    }

    // 4.5 Interpolate the Pug placeholders in the built index. In server
    // mode Express renders build/index.pug per request, filling globals
    // like FORCE_CONFIG_PATH and MAIN_MISSION; a dashboard has no server,
    // so bake the static equivalents here (unknown placeholders become
    // empty strings — the same as unset env vars under Pug).
    const indexPath = path.join(rootDir, "build", "index.html");
    const packagejson = require(path.join(rootDir, "package.json"));
    const staticGlobals = {
      user: "",
      permission: "000",
      groups: "[]",
      AUTH: "off",
      NODE_ENV: "production",
      VERSION: packagejson.version,
      FORCE_CONFIG_PATH: "",
      CLEARANCE_NUMBER: "",
      LINK_PREVIEW_TITLE: deployment.name || mission,
      LINK_PREVIEW_DESCRIPTION: `MMGIS dashboard for ${mission}`,
      ENABLE_MMGIS_WEBSOCKETS: "false",
      MAIN_MISSION: mission,
      IS_DOCKER: "false",
      SKIP_CLIENT_INITIAL_LOGIN: "true",
      THIRD_PARTY_COOKIES: "false",
      PORT: "",
      ROOT_PATH: "",
      WEBSOCKET_ROOT_PATH: "",
      WITH_TITILER: "false",
      HOSTS: "{}",
    };
    // Escape per placeholder context so values like a mission named
    // `Jezero "Delta"` can't break the inline <script> or the <title>.
    // LINK_PREVIEW_* sit in HTML (title text / meta attribute); every other
    // placeholder sits in a double-quoted JS string in the production branch.
    const htmlContextKeys = new Set([
      "LINK_PREVIEW_TITLE",
      "LINK_PREVIEW_DESCRIPTION",
    ]);
    // Escape for a double-quoted JS string literal. JSON.stringify handles
    // backslashes, quotes and control chars; the extra escaping of every "<"
    // stops a value containing "</script>" from closing the inline <script>.
    const escapeForJsString = (value) =>
      JSON.stringify(String(value))
        .slice(1, -1)
        .replace(/</g, "\\u003c");
    const escapeForHtml = (value) =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    fs.writeFileSync(
      indexPath,
      fs
        .readFileSync(indexPath, "utf8")
        .replace(/#\{([A-Za-z_]+)\}/g, (m, key) => {
          const value = staticGlobals[key];
          if (value == null) return "";
          return htmlContextKeys.has(key)
            ? escapeForHtml(value)
            : escapeForJsString(value);
        })
    );
    log("Interpolated static globals into index.html.");

    // 5. Upload the bundle. The static index references ./build/... and
    // public/... — the same paths Express mounts in server mode — so the
    // bucket must mirror that layout: the webpack output under build/,
    // the repo's public/ assets under public/, and index.html at the
    // root (the distribution's default root object).
    // Both filters skip a template that still carries the raw #{...}
    // placeholders: build/index.pug is the Pug conversion scripts/build.js
    // writes into build/, and public/index.html is the HTML template the
    // build renders from. Either one served as-is would hand a visitor the
    // placeholders un-interpolated. The rendered page is uploaded below.
    // A publish only writes; it deletes nothing already in the bucket.
    const uploadedBuild = await provision.uploadDirectory({
      bucket,
      dir: path.join(rootDir, "build"),
      prefix: "build/",
      filter: (key) => key !== "build/index.pug",
    });
    const uploadedPublic = await provision.uploadDirectory({
      bucket,
      dir: path.join(rootDir, "public"),
      prefix: "public/",
      filter: (key) => key !== "public/index.html",
    });
    await provision.uploadFile({
      bucket,
      key: "index.html",
      filePath: path.join(rootDir, "build", "index.html"),
    });
    // LandingPage's static branch fetches Missions/<mission>/config.json
    // directly (the legacy static-hosting convention; not routed through
    // the dispatcher), so the baked config must also live at that key.
    const bakedConfigPath = path.join(
      os.tmpdir(),
      `mmgis-baked-config-${deployment.id}.json`
    );
    fs.writeFileSync(bakedConfigPath, JSON.stringify(baked.get));
    await provision.uploadFile({
      bucket,
      key: `Missions/${mission}/config.json`,
      filePath: bakedConfigPath,
    });
    fs.unlinkSync(bakedConfigPath);
    log(
      `Uploaded ${uploadedBuild} build and ${uploadedPublic} public file(s) to ${bucket}.`
    );

    // 5.5 Invalidate our own distribution so the five-minute tier serves the
    // new release now. Customers' edges are governed by the Cache-Control
    // tiers instead — see
    // docs/infrastructure/serving-a-dashboard-from-your-domain.md. A brand-new
    // distribution has nothing cached, so doing this unconditionally keeps
    // publish and update on one path.
    if (outputs.DistributionId) {
      await provision.createInvalidation({
        distributionId: outputs.DistributionId,
        paths: ["/*"],
      });
      log("Created CloudFront invalidation (/*).");
    }

    // 6. Terminal row update
    const cloudfrontUrl =
      outputs.DistributionDomainName != null
        ? `https://${outputs.DistributionDomainName}`
        : deployment.cloudfront_url;
    const [published] = await Deployments.update(
      {
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
      },
      { where: publishedWhere }
    );
    log(
      published
        ? `Deployment ${deployment.id} published at ${cloudfrontUrl}.`
        : `Deployment ${deployment.id} is being deleted; leaving its status alone.`
    );
  } catch (err) {
    console.error(err);
    await Deployments.update(
      {
        status: Deployments.STATUS.FAILED,
        last_error: err.message || String(err),
      },
      { where: failedWhere }
    ).catch(() => {});
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[publish-static] Failed: ${err.message}`);
    process.exit(1);
  });
