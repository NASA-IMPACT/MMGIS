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
 *                       UpdateStack — including re-rendering the auth
 *                       Function with the dashboard's own credential, else
 *                       the environment's — then re-bakes + re-uploads
 *                       the bundle (same URL).
 *   MMGIS_DASHBOARDS_REQUIRE_AUTH - the exact string "false" publishes
 *                       dashboards with no password gate; any other value,
 *                       including unset, gates them. Set per environment by
 *                       Terraform's dashboards_require_auth.
 *   MMGIS_PUBLISH_PRECOMPRESS - the exact string "false" uploads every file
 *                       raw; any other value, including unset, brotli-
 *                       compresses the bundle's text assets at publish and
 *                       stores them at the same key with Content-Encoding:
 *                       br (CloudFront never compresses objects over 10 MB,
 *                       and the vendor chunk is 13 MB). A kill switch, not
 *                       per-environment configuration.
 *
 * Flow: render the stack template and read the stack, so a missing password
 * or an unusable stack is answered before the long steps → read the mission
 * config from Postgres → apply bake guards → stage a copy of the image's
 * prebuilt build/ (compiled once at image build; this task runs no webpack)
 * and write the static globals and static config into its index.html →
 * CreateStack/UpdateStack + poll to the terminal status → same-key copy the
 * mission's assets from the shared admin bucket → upload the staged bundle →
 * mark the row `published`.
 * Any failure marks the row `failed` with last_error. Both terminal writes
 * skip a row a Delete has already claimed, and a task that finds its row
 * already claimed by a Delete when it starts stops before touching AWS.
 *
 * On ECS the task first records its own ARN on the row (from the container
 * metadata endpoint ECS injects as ECS_CONTAINER_METADATA_URI_V4), so the
 * admin can ask ECS whether it is still alive; a local run has no such
 * endpoint and skips the step.
 */

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const Sequelize = require("sequelize");

const rootDir = path.join(__dirname, "..");

const provision = require("./lib/aws-provision");
const {
  dashboardsAuthRequiredFromEnv,
  renderCfnTemplate,
  stackNameForDeployment,
} = require("./lib/cfn-template");
const {
  applyTimeBakeGuard,
  assertThemeCssPresent,
} = require("./lib/bake-guards");
const { stageBuild, renderStaticIndex } = require("./lib/static-index");

const DEPLOYMENT_ID = process.env.MMGIS_DEPLOYMENT_ID || process.argv[2];
const ACTION = process.env.MMGIS_DEPLOYMENT_ACTION || process.argv[3] || "publish";
const PRECOMPRESS = process.env.MMGIS_PUBLISH_PRECOMPRESS !== "false";

const { requireEnv, UNUSABLE_STACK_STATUSES, unusableStackMessage } = provision;

function log(message) {
  console.log(`[publish-static] ${message}`);
}

// Reads what a dashboard bakes from the database: the mission's latest
// configuration (`get`, uploaded as Missions/<mission>/config.json) and the
// answers src/pre/staticHandlers.js serves by call name (`missions`,
// `get_generaloptions`, written into index.html's static-config block).
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

// Records this task's own ECS task ARN on the row, so a row whose task dies
// before its terminal write can still be reconciled against ECS. The admin
// that started the task records the ARN too; this write covers the window
// before that one lands and the case where it never does. Best-effort: a
// failure here only logs, a metadata endpoint that does not answer within
// five seconds counts as one, and a run outside ECS (no endpoint) skips it.
async function registerOwnTaskArn(Deployments, deploymentId) {
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (metadataUri == null || metadataUri === "") return;
  try {
    const resp = await fetch(`${metadataUri}/task`, {
      signal: AbortSignal.timeout(5000),
    });
    const taskArn = (await resp.json()).TaskARN;
    if (taskArn == null) throw new Error("task metadata carries no TaskARN");
    await Deployments.recordPublishTaskArn(deploymentId, taskArn);
    log(`Registered this task as ${taskArn}.`);
  } catch (err) {
    log(`Could not register this task's ARN (${err.message}); continuing.`);
  }
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

  await registerOwnTaskArn(Deployments, deployment.id);

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

  let stagedRoot = null;
  try {
    // A Delete raised between the admin's request and this task's first
    // line has already claimed the row and is tearing its stack down; this
    // task must not create or converge a stack behind it.
    await deployment.reload();
    if (
      deployment.status === Deployments.STATUS.DELETING ||
      deployment.status === Deployments.STATUS.DELETED
    )
      throw new Error(
        `Deployment row ${deployment.id} is ${deployment.status}, not publishing`
      );

    const mission = deployment.mission;
    const stackName =
      deployment.stack_name || stackNameForDeployment(deployment.id);

    // 1. Preflight the stack and the template, before the bake: a missing
    //    password, a missing stack or a wedged one is a verdict this run can
    //    reach in seconds, before any database read or staging.
    //    A dashboard with its own credential (`settings.auth`) is gated with
    //    it; otherwise the environment's gate and shared password apply.
    const own = deployment.settings && deployment.settings.auth;
    const requireAuth =
      !!own ||
      dashboardsAuthRequiredFromEnv(process.env.MMGIS_DASHBOARDS_REQUIRE_AUTH);
    if (!requireAuth)
      log("MMGIS_DASHBOARDS_REQUIRE_AUTH=false — publishing with no password.");
    const templateBody = renderCfnTemplate(
      own ||
        (requireAuth
          ? { password: requireEnv("MMGIS_DASHBOARDS_PASSWORD") }
          : { requireAuth: false })
    );
    // Idempotent re-run: a previous attempt may have created the stack (or a
    // prior update converged it) — reuse it instead of dying on
    // CloudFormation's AlreadyExistsException.
    const existing = await provision.describeStack({ stackName });
    // A stack in a dead-end state gets guidance matched to that state, never
    // a wait and never a busy misclassification.
    if (
      existing != null &&
      UNUSABLE_STACK_STATUSES.indexOf(existing.StackStatus) !== -1
    )
      throw new Error(unusableStackMessage(stackName, existing.StackStatus));
    if (ACTION === "update" && existing == null)
      throw new Error(
        `Stack '${stackName}' does not exist — publish before updating`
      );

    // 2. Read what the dashboard bakes from the database
    log(`Baking mission '${mission}' for deployment ${deployment.id}...`);
    const baked = await buildBakedConfig(mission);

    // 3. Stage the image's prebuilt bundle and write this dashboard into its
    // index.html. build/ (theme CSS under build/dist/ included) was compiled
    // once at image build, so nothing here runs webpack. In server mode
    // Express renders build/index.pug per request, filling globals like
    // FORCE_CONFIG_PATH and MAIN_MISSION; a dashboard has no server, so the
    // static equivalents are baked into the staged index.html here, along
    // with the static-config block that switches the bundle to its static
    // personality. Done before touching AWS, so a bundle without the
    // configured theme or without the static-config anchor fails in seconds.
    const stagedBuildDir = stageBuild(path.join(rootDir, "build"));
    stagedRoot = path.dirname(stagedBuildDir);
    log(`Staged the prebuilt bundle at ${stagedBuildDir}.`);
    assertThemeCssPresent(baked.get, stagedBuildDir);
    const indexPath = path.join(stagedBuildDir, "index.html");
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
    fs.writeFileSync(
      indexPath,
      renderStaticIndex(fs.readFileSync(indexPath, "utf8"), {
        globals: staticGlobals,
        config: {
          missions: baked.missions,
          get_generaloptions: baked.get_generaloptions,
        },
      })
    );
    log("Wrote static globals and static config into the staged index.html.");

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
          "re-renders the auth Function with the dashboard's own credential, " +
          "else the environment's."
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
    //    when one is configured, included). Copied assets are served by the
    //    same viewer-request Function as the bundle, gate or no gate.
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

    // 6. Upload the bundle. The static index references ./build/... and
    // public/... — the same paths Express mounts in server mode — so the
    // bucket must mirror that layout: the webpack output under build/,
    // the repo's public/ assets under public/, and index.html at the
    // root (the distribution's default root object).
    // Both skipped keys are un-rendered templates whose bodies are still
    // full of `#{…}` placeholders.
    if (!PRECOMPRESS)
      log("MMGIS_PUBLISH_PRECOMPRESS=false — uploading every file raw.");
    const uploadedBuild = await provision.uploadDirectory({
      bucket,
      dir: stagedBuildDir,
      prefix: "build/",
      filter: (key) => key !== "build/index.pug",
      precompress: PRECOMPRESS,
    });
    const uploadedPublic = await provision.uploadDirectory({
      bucket,
      dir: path.join(rootDir, "public"),
      prefix: "public/",
      filter: (key) => key !== "public/index.html",
      precompress: PRECOMPRESS,
    });
    await provision.uploadFile({
      bucket,
      key: "index.html",
      filePath: indexPath,
    });
    // LandingPage's static branch fetches Missions/<mission>/config.json
    // directly (the legacy static-hosting convention; not routed through
    // the dispatcher), so the mission config lives at that key.
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
      `Uploaded ${uploadedBuild.count} build and ${uploadedPublic.count} public file(s) to ${bucket}.`
    );
    if (PRECOMPRESS)
      log(
        `Precompressed ${uploadedBuild.precompressed + uploadedPublic.precompressed} file(s) with brotli: ` +
          `${uploadedBuild.rawBytes + uploadedPublic.rawBytes} -> ` +
          `${uploadedBuild.compressedBytes + uploadedPublic.compressedBytes} bytes.`
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
  } finally {
    if (stagedRoot != null)
      fs.rmSync(stagedRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[publish-static] Failed: ${err.message}`);
    process.exit(1);
  });
