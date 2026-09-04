/**
 * publish-static.js
 * ECS publish-task entrypoint for the lean Deployments feature
 * (run as `node scripts/publish-static.js` from the repo root, in the same
 * image as the admin app — PR 11 provisions the task definition).
 *
 * Driven by environment:
 *   MMGIS_DEPLOYMENT_ID     - the deployments row to publish (required)
 *   MMGIS_DEPLOYMENT_ACTION - "publish" (default) creates the CloudFormation
 *                       stack when none exists yet, or waits for an existing
 *                       one to settle (a previous attempt may have created
 *                       it, or an earlier "update" may still be converging
 *                       it); "update" converges an existing stack's
 *                       infrastructure to the current template via
 *                       UpdateStack — including re-baking the current
 *                       dashboards password into the auth Function — then
 *                       re-bakes + re-uploads the bundle (same URL).
 *
 * Flow: render the stack template and read the stack, so a bad password or
 * an unusable stack is answered before the long steps → read the mission
 * config from Postgres → apply bake guards → bake via bakeStaticConfig →
 * build themes + static webpack bundle (SERVER=static) →
 * CreateStack/UpdateStack + poll to the terminal status → same-key copy the
 * mission's assets from the shared admin bucket → upload the bundle → mark
 * the row `published`.
 * Any failure marks the row `failed` with last_error. Both terminal writes
 * skip a row a Delete has already claimed.
 */

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Sequelize = require("sequelize");

const rootDir = path.join(__dirname, "..");

const provision = require("./lib/aws-provision");
const { renderCfnTemplate, stackNameForDeployment } = require("./lib/cfn-template");
const { applyTimeBakeGuard } = require("./lib/bake-guards");

const DEPLOYMENT_ID = process.env.MMGIS_DEPLOYMENT_ID || process.argv[2];
const ACTION = process.env.MMGIS_DEPLOYMENT_ACTION || process.argv[3] || "publish";

const { requireEnv } = provision;

// Statuses a stack can neither be reused at nor driven forward from: it can
// only be deleted (or, for a couple, have a rollback continued) — never
// updated in place. Reaching one earns the actionable "delete and republish"
// guidance BEFORE any busy classification, so a permanently-wedged stack is
// never mistaken for one another task is merely busy updating.
//   CREATE_FAILED / ROLLBACK_COMPLETE / ROLLBACK_IN_PROGRESS - a failed first
//     create: CREATE_FAILED is where this code's own createStack (OnFailure:
//     "DO_NOTHING") stops; the ROLLBACK_* pair is where an out-of-band operator
//     create stops, and ROLLBACK_IN_PROGRESS pre-empts the ROLLBACK_COMPLETE it
//     is on its way to.
//   ROLLBACK_FAILED / UPDATE_ROLLBACK_FAILED / DELETE_FAILED - a rollback or a
//     delete that itself failed; stuck until an operator intervenes.
//   UPDATE_FAILED - where an update with rollback disabled stops; moved only by
//     a ContinueUpdateRollback or a delete, so it can't be updated in place.
//   DELETE_IN_PROGRESS - a teardown already under way: the bucket and
//     distribution this run needs are on their way out, so waiting it out can
//     only ever end at a stack that no longer exists.
// UPDATE_ROLLBACK_COMPLETE is deliberately absent: a stack resting there has a
// working bucket/distribution and stays reusable by a publish.
const UNUSABLE_STACK_STATUSES = [
  "CREATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_IN_PROGRESS",
  "ROLLBACK_FAILED",
  "UPDATE_ROLLBACK_FAILED",
  "UPDATE_FAILED",
  "DELETE_FAILED",
  "DELETE_IN_PROGRESS",
];

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

  // Scopes this task's terminal writes to a row the delete flow has not
  // claimed. A Delete raised while this task runs moves the row to `deleting`
  // and tears the stack down behind us; that row's next status is `deleted`,
  // decided by the delete flow, not by however this task happens to end.
  const liveRowWhere = (id) => ({
    id,
    status: {
      [Sequelize.Op.notIn]: [
        Deployments.STATUS.DELETING,
        Deployments.STATUS.DELETED,
      ],
    },
  });

  try {
    const mission = deployment.mission;
    const stackName =
      deployment.stack_name || stackNameForDeployment(deployment.id);

    // 1. Preflight the stack and the template, before the minutes-long bake
    //    and build: a missing password, a missing stack or a wedged one is a
    //    verdict this run can reach in seconds, and reaching it late costs the
    //    whole build for an answer that never depended on it.
    const templateBody = renderCfnTemplate({
      password: requireEnv("MMGIS_DASHBOARDS_PASSWORD"),
    });
    // Idempotent re-run: a previous attempt may have created the stack (or a
    // prior update converged it) — reuse it instead of dying on
    // CloudFormation's AlreadyExistsException.
    const existing = await provision.describeStack({ stackName });
    // A stack in a delete-only dead-end state gets actionable guidance, never
    // a wait and never a busy misclassification.
    if (
      existing != null &&
      UNUSABLE_STACK_STATUSES.indexOf(existing.StackStatus) !== -1
    )
      throw new Error(
        `Stack '${stackName}' is in ${existing.StackStatus} and cannot be used — ` +
          "delete the deployment and publish it again (this mints a new URL)"
      );
    if (ACTION === "update" && existing == null)
      throw new Error(
        `Stack '${stackName}' does not exist — publish before updating`
      );

    // 2. Bake the mission config into the bundle
    log(`Baking mission '${mission}' for deployment ${deployment.id}...`);
    const baked = await buildBakedConfig(mission);
    const { bakeStaticConfig } = require("../API/updateTools");
    bakeStaticConfig(baked);

    // 3. Build the static bundle. Theme assets (dist/) are baked into the
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

    // 4. Provision (publish) or converge (update) the dashboard stack
    let stack;
    if (ACTION === "publish") {
      // Publish only needs a working bucket, so it never runs UpdateStack: it
      // either creates the stack, or waits for whatever the existing one is
      // doing to settle. A stack already RESTING at its settle target
      // (CREATE_COMPLETE / UPDATE_COMPLETE / UPDATE_ROLLBACK_COMPLETE) resolves
      // on the first poll — status already matches, no `prior`, no pre-sleep.
      if (existing == null) {
        log(`Creating stack '${stackName}'...`);
        await provision.createStack({ stackName, templateBody });
        stack = await provision.waitForStack({ stackName });
      } else {
        log(
          `Stack '${stackName}' already exists (${existing.StackStatus}); waiting for it to settle.`
        );
        stack = await provision.waitForStack({
          stackName,
          desiredStatus: provision.settleStatusFor(existing.StackStatus),
        });
      }
      log(`Stack '${stackName}' reached ${stack.StackStatus}.`);
    } else {
      log(
        `Converging stack '${stackName}' to the current template — this ` +
          "re-bakes the current dashboards password into the auth Function."
      );
      // Converge OUR OWN template through provision's single retry loop: it
      // runs UpdateStack, waits out any concurrent operation (a double
      // republish race) and retries our own update, and waits for OUR update
      // to reach UPDATE_COMPLETE — a rollback throws rather than passing as
      // success. The preflight above already rejected the delete-only dead-end
      // statuses, so a busy error inside can only be a genuinely in-flight op.
      stack = await provision.convergeStackUpdate({
        stackName,
        templateBody,
        log,
      });
      log(`Stack '${stackName}' reached ${stack.StackStatus}.`);
    }
    const outputs = provision.getStackOutputs(stack);
    const bucket = outputs.BucketName;
    if (bucket == null)
      throw new Error(`Stack '${stackName}' has no BucketName output`);

    // 5. Same-key copy the mission's assets from the shared admin bucket
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

      // Viewer-panel mosaic file (conditional): the Photosphere/ModelViewer
      // panes fetch this hardcoded same-origin path. Copy it when present;
      // when absent the panes fail silently rather than erroring.
      const mosaicKey = `Missions/${missionFolderName}/Data/mosaic_parameters.csv`;
      const mosaicCopied = await provision.copyObjectIfExists({
        sourceBucket: sharedBucket,
        destBucket: bucket,
        key: mosaicKey,
      });
      if (mosaicCopied) log(`Copied ${mosaicKey}.`);
    } else {
      log("MMGIS_SHARED_ASSET_BUCKET not set; skipping mission asset copy.");
    }

    // 5.5 Interpolate the Pug placeholders in the built index. In server
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

    // 6. Upload the bundle. The static index references ./build/... and
    // public/... — the same paths Express mounts in server mode — so the
    // bucket must mirror that layout: the webpack output under build/,
    // the repo's public/ assets under public/, and index.html at the
    // root (the distribution's default root object).
    // Both skipped keys are un-rendered templates whose bodies are still
    // full of `#{…}` placeholders.
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

    // 6.5 Bust the CDN so the refreshed bundle/config/assets serve
    // immediately — the distribution caches aggressively, and only the
    // hashed bundle filenames are naturally cache-safe. A brand-new
    // distribution has nothing cached, so doing this unconditionally
    // keeps publish and update on one path.
    if (outputs.DistributionId) {
      await provision.createInvalidation({
        distributionId: outputs.DistributionId,
        paths: ["/*"],
      });
      log("Created CloudFront invalidation (/*).");
    }

    // 7. Terminal row update
    const cloudfrontUrl =
      outputs.DistributionDomainName != null
        ? `https://${outputs.DistributionDomainName}`
        : deployment.cloudfront_url;
    await Deployments.update(
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
      { where: liveRowWhere(deployment.id) }
    );
    log(`Deployment ${deployment.id} published at ${cloudfrontUrl}.`);
  } catch (err) {
    console.error(err);
    await Deployments.update(
      {
        status: Deployments.STATUS.FAILED,
        last_error: err.message || String(err),
      },
      { where: liveRowWhere(deployment.id) }
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
