/**
 * aws-provision.js
 * Thin wrappers over the @aws-sdk v3 clients used by the Deployments
 * publish flow: CloudFormation stack lifecycle, S3 bundle upload /
 * asset copy / bucket emptying, and the ECS RunTask that starts the
 * publish task.
 *
 * Clients are created lazily (first call) and can be injected with
 * setClients() so unit tests never touch real AWS.
 */

const fs = require("fs");
const path = require("path");

const {
  CloudFormationClient,
  CreateStackCommand,
  UpdateStackCommand,
  DescribeStacksCommand,
  DeleteStackCommand,
} = require("@aws-sdk/client-cloudformation");
const {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const {
  CloudFrontClient,
  CreateInvalidationCommand,
} = require("@aws-sdk/client-cloudfront");

let _clients = null;

function getClients() {
  if (_clients == null) {
    const region = process.env.AWS_REGION;
    _clients = {
      cfn: new CloudFormationClient({ region }),
      s3: new S3Client({ region }),
      ecs: new ECSClient({ region }),
      cloudfront: new CloudFrontClient({ region }),
    };
  }
  return _clients;
}

// Test seam: inject mock clients ({ cfn, s3, ecs, cloudfront }), or null to reset.
function setClients(clients) {
  _clients = clients;
}

/* ------------------------------ CloudFormation ------------------------------ */

// Gap between DescribeStacks polls, and between a busy rejection and the
// retry that follows it.
const DEFAULT_POLL_INTERVAL_MS = 15000;

const TERMINAL_STACK_STATUSES = [
  "CREATE_COMPLETE",
  "CREATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "DELETE_COMPLETE",
  "DELETE_FAILED",
  "UPDATE_COMPLETE",
  // Where an update with rollback disabled leaves a stack; waiting on it can
  // only ever burn the timeout.
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
];

// Statuses a stack can neither be reused at nor driven forward from: it can
// only be deleted (or, for a couple, have a rollback continued) — never
// updated in place. Reaching one earns the actionable "delete and republish"
// guidance BEFORE any busy classification, so a permanently-wedged stack is
// never mistaken for one another task is merely busy updating.
//   CREATE_FAILED / ROLLBACK_COMPLETE / ROLLBACK_IN_PROGRESS - a failed first
//     create: CREATE_FAILED is where createStack (OnFailure: "DO_NOTHING")
//     stops; the ROLLBACK_* pair is where an out-of-band operator create stops,
//     and ROLLBACK_IN_PROGRESS pre-empts the ROLLBACK_COMPLETE it is on its
//     way to.
//   ROLLBACK_FAILED / UPDATE_ROLLBACK_FAILED / DELETE_FAILED - a rollback or a
//     delete that itself failed; stuck until an operator intervenes.
//   UPDATE_FAILED - where an update with rollback disabled stops; moved only by
//     a ContinueUpdateRollback or a delete, so it can't be updated in place.
//   DELETE_IN_PROGRESS - the deployment is being torn down; the stack and its
//     bucket are on their way out, so there is nothing to publish onto.
// UPDATE_ROLLBACK_COMPLETE is deliberately absent: a stack resting there has a
// working bucket/distribution and stays reusable.
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

// Throws the actionable "delete and republish" guidance when `stack` rests in
// a delete-only status, so a wedged stack never reads as a raw CloudFormation
// rejection or as another task merely being busy.
function assertStackUsable({ stackName, stack }) {
  if (UNUSABLE_STACK_STATUSES.indexOf(stack.StackStatus) !== -1)
    throw new Error(
      `Stack '${stackName}' is in ${stack.StackStatus} and cannot be used — ` +
        "delete the deployment and publish it again (this mints a new URL)"
    );
}

async function createStack({ stackName, templateBody }) {
  const { cfn } = getClients();
  const resp = await cfn.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      OnFailure: "DO_NOTHING",
      Tags: [{ Key: "mmgis:deployment", Value: stackName }],
    })
  );
  return resp.StackId;
}

// Applies the current template to an existing stack. Returns true when an
// update started, false when CloudFormation reports there is nothing to
// change. The no-op arrives as a ValidationError, the SAME error name
// DescribeStacks uses for "stack does not exist" — so match on the message.
async function updateStack({ stackName, templateBody }) {
  const { cfn } = getClients();
  try {
    await cfn.send(
      new UpdateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        Tags: [{ Key: "mmgis:deployment", Value: stackName }],
      })
    );
    return true;
  } catch (err) {
    if (
      err.name === "ValidationError" &&
      (err.message || "").indexOf("No updates are to be performed") !== -1
    )
      return false;
    throw err;
  }
}

// True only for the ValidationError CloudFormation raises when the stack is
// busy with an operation genuinely IN FLIGHT ("Stack:arn:... is in
// UPDATE_IN_PROGRESS state and can not be updated."). Two republish clicks
// start two ECS tasks and the loser lands here — a race to wait out, not a
// failure. CloudFormation reuses the same "... state and can not be updated"
// wording for wedged terminal statuses too (UPDATE_ROLLBACK_FAILED,
// UPDATE_FAILED, DELETE_FAILED), which are delete-only dead ends, NOT another
// task updating — so key off the status the message names and accept only an
// *_IN_PROGRESS one. Same error NAME as the no-op and does-not-exist cases, so
// the message stays the only discriminator.
function isStackBusyError(err) {
  if (err == null || err.name !== "ValidationError") return false;
  const named = (err.message || "").match(
    /is in ([A-Z_]+) state and can not be updated/
  );
  return named != null && named[1].endsWith("_IN_PROGRESS");
}

// Returns the Stack object, or null when the stack does not exist.
// Other errors (credentials, network, throttling) are rethrown.
async function describeStack({ stackName }) {
  const { cfn } = getClients();
  try {
    const resp = await cfn.send(
      new DescribeStacksCommand({ StackName: stackName })
    );
    return (resp.Stacks && resp.Stacks[0]) || null;
  } catch (err) {
    if (
      err.name === "ValidationError" &&
      (err.message || "").indexOf("does not exist") !== -1
    )
      return null;
    throw err;
  }
}

// True when a stack's LastUpdatedTime has moved past the one observed
// before the operation. Absent-then-present counts: CloudFormation only
// returns the field once a stack has been updated at least once.
function lastUpdatedAdvanced(current, prior) {
  if (current == null) return false;
  if (prior == null) return true;
  return new Date(current).getTime() > new Date(prior).getTime();
}

// Polls DescribeStacks until the stack reaches a terminal status.
// Resolves with the Stack object on success; throws on failure statuses,
// disappearance, or timeout.
//
// `desiredStatus` is one status or a list of them; the wait resolves on any
// member, and the terminal-status throw still fires for a terminal status
// outside the set.
//
// `prior` is the { status, lastUpdatedTime } read immediately BEFORE the
// operation being waited on (pass it after an UpdateStack; the create path
// has nothing to pass). DescribeStacks is eventually consistent, so a read
// counts as stale — and is polled through rather than acted on — while it
// matches `prior` on BOTH fields; an advanced LastUpdatedTime is positive
// proof this operation landed, so no transition has to be caught mid-flight.
async function waitForStack({
  stackName,
  desiredStatus = "CREATE_COMPLETE",
  prior = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = 30 * 60 * 1000,
}) {
  const desired = Array.isArray(desiredStatus)
    ? desiredStatus
    : [desiredStatus];
  // How the timeout message names what the wait was after: one status is
  // quoted, a set is spelled out.
  const desiredLabel =
    desired.length > 1
      ? `settle (any of: ${desired.join(", ")})`
      : `reach '${desired[0]}'`;
  const startedAt = Date.now();
  // CloudFormation usually puts the failure reason on the IN_PROGRESS
  // rollback status and leaves the terminal one empty, so remember the last
  // reason seen rather than reading only the status we throw on. Skip the
  // boilerplate "User Initiated" CloudFormation stamps on *_IN_PROGRESS
  // statuses, so it can't get attached to a later terminal failure message.
  let lastReason = null;
  for (;;) {
    const stack = await describeStack({ stackName });
    if (stack == null)
      throw new Error(
        `Stack '${stackName}' does not exist (deleted or never created)`
      );
    const stale =
      prior != null &&
      stack.StackStatus === prior.status &&
      !lastUpdatedAdvanced(stack.LastUpdatedTime, prior.lastUpdatedTime);
    if (!stale) {
      if (stack.StackStatusReason && stack.StackStatusReason !== "User Initiated")
        lastReason = stack.StackStatusReason;
      if (desired.indexOf(stack.StackStatus) !== -1) return stack;
      if (TERMINAL_STACK_STATUSES.indexOf(stack.StackStatus) !== -1)
        throw new Error(
          `Stack '${stackName}' reached terminal status '${stack.StackStatus}'` +
            (lastReason ? `: ${lastReason}` : "")
        );
    }
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(
        `Timed out waiting for stack '${stackName}' to ${desiredLabel} (last status '${stack.StackStatus}')` +
          (lastReason ? `: ${lastReason}` : "")
      );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Converges `templateBody` onto an existing stack via UpdateStack and waits
// for our update to finish. Returns the converged Stack, or the latest read
// of it when there is nothing to update.
//
// Every attempt starts on a stack assertStackUsable has cleared, so an
// isStackBusyError here is only ever a concurrent republish. On that race we
// wait the other task's operation out and retry our OWN UpdateStack, so this
// run's template — not merely the winner's — converges; `maxBusyRetries`
// bounds the wait.
async function convergeStackUpdate({
  stackName,
  templateBody,
  existing,
  maxBusyRetries = 10,
  log = () => {},
  // Forwarded to both waitForStack calls, and used as the pause between a busy
  // rejection and the retry (production takes the defaults — tests inject a
  // tiny interval).
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs,
}) {
  // The read just before our own UpdateStack, passed as `prior` to the
  // converge wait and returned as-is when there is nothing to update; a
  // wait-out advances it to the other task's settled state.
  let preUpdate = existing;
  for (let attempt = 0; ; attempt++) {
    // Checked per attempt, not just once: a wait-out can settle on a
    // delete-only status, which earns the guidance rather than an UpdateStack
    // that CloudFormation would reject with its own opaque wording.
    assertStackUsable({ stackName, stack: preUpdate });
    let started;
    try {
      started = await updateStack({ stackName, templateBody });
    } catch (err) {
      if (!isStackBusyError(err)) throw err;
      if (attempt >= maxBusyRetries)
        throw new Error(
          `Stack '${stackName}' stayed busy after ${maxBusyRetries + 1} ` +
            "UpdateStack attempts — another operation may be stuck; try again shortly."
        );
      const current = (await describeStack({ stackName })) || preUpdate;
      log(
        `Stack '${stackName}' is busy with another operation ` +
          `(${current.StackStatus}); waiting for it to settle, then retrying.`
      );
      // Resolve on whatever status the other operation settles at (a rollback
      // settles at UPDATE_ROLLBACK_COMPLETE, which is still updatable) and let
      // the next attempt judge it. The busy rejection is itself proof an
      // operation is in flight, so the read taken before it is stale: pass it
      // as `prior` and poll through reads that still match it.
      preUpdate = await waitForStack({
        stackName,
        desiredStatus: TERMINAL_STACK_STATUSES,
        prior: {
          status: preUpdate.StackStatus,
          lastUpdatedTime: preUpdate.LastUpdatedTime,
        },
        pollIntervalMs,
        timeoutMs,
      });
      // The winner's operation only just settled; give CloudFormation a beat
      // before asking it to accept ours.
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    // "No updates are to be performed" — the template already converged.
    if (!started) {
      log(`Stack '${stackName}' is already up to date.`);
      return preUpdate;
    }
    log(`Updating stack '${stackName}'...`);
    // The strict single UPDATE_COMPLETE makes our own rollback, settling at
    // UPDATE_ROLLBACK_COMPLETE, hit the terminal-status throw rather than be
    // reported as a successful publish.
    return await waitForStack({
      stackName,
      desiredStatus: "UPDATE_COMPLETE",
      prior: {
        status: preUpdate.StackStatus,
        lastUpdatedTime: preUpdate.LastUpdatedTime,
      },
      pollIntervalMs,
      timeoutMs,
    });
  }
}

// { OutputKey: OutputValue, ... } from a Stack object.
function getStackOutputs(stack) {
  const outputs = {};
  ((stack && stack.Outputs) || []).forEach((o) => {
    outputs[o.OutputKey] = o.OutputValue;
  });
  return outputs;
}

async function deleteStack({ stackName }) {
  const { cfn } = getClients();
  await cfn.send(new DeleteStackCommand({ StackName: stackName }));
}

/* ----------------------------------- S3 ----------------------------------- */

const CONTENT_TYPES = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp4": "video/mp4",
};

function contentTypeForFile(filePath) {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
    "application/octet-stream"
  );
}

// The object keys API/Backend/Upload/uploadRouter.js writes for plugin
// uploads: "assets/", exactly two path segments, then "/uploads/". The same
// classifier lives in src/pre/uploadKey.ts and configure/src/core/upload.js;
// tests/unit/uploadKeyClassifier.spec.js runs one table through all three.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

// Cache-Control tier for a published-dashboard object key. The entry page and
// baked config must revalidate on every request (a fronting cache we cannot
// invalidate may otherwise pin an old release for a day); two classes are
// immutable because their names are content-addressed by construction — the
// webpack output, whose filenames carry a content hash (pinned by
// tests/unit/webpackHashedOutput.spec.js), and plugin uploads under
// assets/<mission>/<subdir>/uploads/, which the upload router names
// crypto.randomUUID() and never overwrites (API/Backend/Upload/uploadRouter.js).
// Everything else — the keys that really do change in place on republish —
// falls back to a short TTL. Two runtime families sit in that fallback under
// stable names, the pdf.js worker under public/workers and the Cesium tree
// under build/static/cesium, so a republish that bumps the MMGIS version can
// leave a customer's edge pairing a new bundle with a copy of those up to five
// minutes old.
function cacheControlForKey(key) {
  if (
    key === "index.html" ||
    key === "build/index.html" ||
    /^Missions\/[^/]+\/config\.json$/.test(key)
  )
    return "no-cache";
  if (
    /^build\/static\/(js|css|media)\//.test(key) ||
    ASSETS_UPLOAD_KEY.test(key)
  )
    return "public, max-age=31536000, immutable";
  return "public, max-age=300";
}

function walkDirectory(dir, baseDir) {
  baseDir = baseDir || dir;
  let files = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((item) => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files = files.concat(walkDirectory(full, baseDir));
    else if (item.isFile())
      files.push({
        absolute: full,
        key: path.relative(baseDir, full).split(path.sep).join("/"),
      });
  });
  return files;
}

// Uploads every file under `dir` to `bucket`, keys relative to `dir`
// (optionally prefixed). `filter` receives that relative key and keeps the
// file when it returns true. Returns the number of files uploaded.
async function uploadDirectory({
  bucket,
  dir,
  prefix = "",
  concurrency = 8,
  filter,
}) {
  const { s3 } = getClients();
  const files = filter
    ? walkDirectory(dir).filter((file) => filter(file.key))
    : walkDirectory(dir);
  let index = 0;
  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      const key = `${prefix}${file.key}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(file.absolute),
          // An explicit length keeps the streaming PUT retryable by the
          // SDK (an unknown-length stream is sent unsigned/non-retryable,
          // so one network blip would fail the whole publish).
          ContentLength: fs.statSync(file.absolute).size,
          ContentType: contentTypeForFile(file.absolute),
          CacheControl: cacheControlForKey(key),
        })
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length || 1) }, worker)
  );
  return files.length;
}

// Uploads a single local file to an exact key.
async function uploadFile({ bucket, key, filePath }) {
  const { s3 } = getClients();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentLength: fs.statSync(filePath).size,
      ContentType: contentTypeForFile(filePath),
      CacheControl: cacheControlForKey(key),
    })
  );
}

// Invalidates paths on our own distribution, the only one this reaches. The
// Cache-Control tiers already cover most of it there — index.html and
// config.json revalidate every request, and hashed bundles arrive under new
// names — so this is what closes the gap for the five-minute tier. Any other
// edge in front of the dashboard is governed by those headers alone.
async function createInvalidation({ distributionId, paths = ["/*"] }) {
  const { cloudfront } = getClients();
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `mmgis-publish-${Date.now()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    })
  );
}

// Builds an S3 CopySource ("bucket/key") with each path segment percent-
// encoded but the "/" separators preserved. encodeURIComponent over the
// whole string would also encode the bucket/key boundary and intra-key
// slashes into %2F, which S3 reads as one literal bucket name -> the copy
// fails with NoSuchBucket/InvalidArgument.
function buildCopySource(bucket, key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encodedKey}`;
}

// Same-key copies every object under `prefix` from sourceBucket into
// destBucket. Returns the number of objects copied.
async function copyPrefix({ sourceBucket, destBucket, prefix }) {
  const { s3 } = getClients();
  let copied = 0;
  let continuationToken;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: sourceBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of list.Contents || []) {
      await s3.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: obj.Key,
          CopySource: buildCopySource(sourceBucket, obj.Key),
          // COPY (the default) cannot set new headers on the copy, so
          // REPLACE is required to add a Cache-Control the source object
          // never had — and REPLACE means supplying ContentType too.
          // REPLACE drops the source's entire metadata set, not just its
          // Content-Type: Content-Encoding, Content-Disposition and any
          // x-amz-meta-* are lost unless restated here. Nothing sets those:
          // the upload router writes ContentType alone.
          MetadataDirective: "REPLACE",
          ContentType: contentTypeForFile(obj.Key),
          CacheControl: cacheControlForKey(obj.Key),
        })
      );
      copied++;
    }
    continuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return copied;
}

// Deletes every object in the bucket (required before DeleteStack can
// remove it). A missing bucket is treated as already empty.
async function emptyBucket({ bucket }) {
  const { s3 } = getClients();
  let deleted = 0;
  try {
    let continuationToken;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        })
      );
      const objects = (list.Contents || []).map((o) => ({ Key: o.Key }));
      if (objects.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          })
        );
        deleted += objects.length;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch (err) {
    if (err.name === "NoSuchBucket") return deleted;
    throw err;
  }
  return deleted;
}

/* ----------------------------------- ECS ----------------------------------- */

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || value === "")
    throw new Error(
      `Missing required environment variable '${name}' (lean publish flow; see sample.env)`
    );
  return value;
}

// Starts the ECS publish task (scripts/publish-static.js) for a deployment.
// The task definition, cluster, and network configuration come from env
// (provisioned by infrastructure/terraform/modules/mmgis-environment/).
// Throws when configuration is missing or RunTask fails — callers record the
// error on the deployment row.
async function runPublishTask({ deploymentId, action }) {
  const cluster = requireEnv("MMGIS_PUBLISH_ECS_CLUSTER");
  const taskDefinition = requireEnv("MMGIS_PUBLISH_TASK_DEFINITION");
  const subnets = requireEnv("MMGIS_PUBLISH_SUBNETS")
    .split(",")
    .map((sub) => sub.trim())
    .filter(Boolean);
  const securityGroups = requireEnv("MMGIS_PUBLISH_SECURITY_GROUPS")
    .split(",")
    .map((sg) => sg.trim())
    .filter(Boolean);
  const containerName = process.env.MMGIS_PUBLISH_CONTAINER_NAME || "mmgis";

  const { ecs } = getClients();
  const resp = await ecs.send(
    new RunTaskCommand({
      cluster,
      taskDefinition,
      launchType: "FARGATE",
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: containerName,
            command: ["node", "scripts/publish-static.js"],
            environment: [
              { name: "MMGIS_DEPLOYMENT_ID", value: `${deploymentId}` },
              { name: "MMGIS_DEPLOYMENT_ACTION", value: action },
            ],
          },
        ],
      },
    })
  );

  const failures = resp.failures || [];
  if (failures.length > 0)
    throw new Error(
      `ECS RunTask failed: ${failures
        .map((f) => `${f.reason || "unknown"}${f.detail ? ` (${f.detail})` : ""}`)
        .join("; ")}`
    );
  return (resp.tasks && resp.tasks[0] && resp.tasks[0].taskArn) || null;
}

module.exports = {
  getClients,
  setClients,
  createStack,
  updateStack,
  isStackBusyError,
  describeStack,
  waitForStack,
  convergeStackUpdate,
  getStackOutputs,
  deleteStack,
  contentTypeForFile,
  cacheControlForKey,
  uploadDirectory,
  uploadFile,
  createInvalidation,
  copyPrefix,
  emptyBucket,
  requireEnv,
  runPublishTask,
};
