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

const TERMINAL_STACK_STATUSES = [
  "CREATE_COMPLETE",
  "CREATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "DELETE_COMPLETE",
  "DELETE_FAILED",
  "UPDATE_COMPLETE",
  // Where an update with rollback disabled leaves a stack. Terminal and
  // permanently stuck: only a ContinueUpdateRollback or a delete moves it,
  // so waiting on it can only ever burn the timeout.
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
];

// How long DescribeStacks polling waits between reads, and how long the
// converge loop pauses after CloudFormation rejects an UpdateStack as busy.
const DEFAULT_POLL_INTERVAL_MS = 15000;

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
// *_IN_PROGRESS one. DELETE_IN_PROGRESS is the exception among those: the
// operation in flight is tearing the stack down, so waiting it out can only
// end at a stack that no longer exists — it belongs with the delete-only dead
// ends. Same error NAME as the no-op and does-not-exist cases, so the message
// stays the only discriminator.
function isStackBusyError(err) {
  if (err == null || err.name !== "ValidationError") return false;
  const named = (err.message || "").match(
    /is in ([A-Z_]+) state and can not be updated/
  );
  return (
    named != null &&
    named[1].endsWith("_IN_PROGRESS") &&
    named[1] !== "DELETE_IN_PROGRESS"
  );
}

// The status an in-flight stack operation settles at, for a caller that
// finds a stack mid-operation and wants to wait it out. A rollback settles
// at UPDATE_ROLLBACK_COMPLETE: waiting for UPDATE_COMPLETE from an in-flight
// rollback can only ever throw, even though a stack resting at
// UPDATE_ROLLBACK_COMPLETE is perfectly reusable. A status that is already
// terminal maps to whatever its family settles at; waitForStack() resolves on
// desired-status equality, so a stuck one (UPDATE_FAILED) never matches its
// unreachable target and still throws on the terminal check before the timeout.
function settleStatusFor(stackStatus) {
  if (stackStatus.indexOf("UPDATE_ROLLBACK_") === 0)
    return "UPDATE_ROLLBACK_COMPLETE";
  if (stackStatus.indexOf("UPDATE_") === 0) return "UPDATE_COMPLETE";
  return "CREATE_COMPLETE";
}

// Returns the Stack object, or null when the stack does not exist. Only the
// ValidationError that names a missing stack reads as absence; every other
// error (credentials, network, throttling, a malformed stack name) is
// rethrown rather than disguised as "no stack here".
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
// `prior` is the { status, lastUpdatedTime } read immediately BEFORE the
// operation being waited on (pass it after an UpdateStack; the create path
// has nothing to pass). DescribeStacks is eventually consistent, so an early
// poll can still return the pre-operation state — and when that status IS
// `desiredStatus` (the ordinary republish of a stack resting at
// UPDATE_COMPLETE) status equality alone would resolve on a stack that has
// not started converging. A read is stale only while it matches `prior` on
// BOTH fields: an advanced LastUpdatedTime is positive proof this operation
// landed, so no transition has to be caught mid-flight.
async function waitForStack({
  stackName,
  desiredStatus = "CREATE_COMPLETE",
  prior = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = 30 * 60 * 1000,
}) {
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
      if (stack.StackStatus === desiredStatus) return stack;
      if (TERMINAL_STACK_STATUSES.indexOf(stack.StackStatus) !== -1)
        throw new Error(
          `Stack '${stackName}' reached terminal status '${stack.StackStatus}'` +
            (lastReason ? `: ${lastReason}` : "")
        );
    }
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(
        `Timed out waiting for stack '${stackName}' to reach '${desiredStatus}' (last status '${stack.StackStatus}')` +
          (lastReason ? `: ${lastReason}` : "")
      );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Converges `templateBody` onto an existing stack via UpdateStack and waits
// for our update to finish. Returns the converged Stack, or the stack as it
// stands when there is nothing to update.
//
// Callers must first turn away the delete-only dead-end statuses (see
// publish-static UNUSABLE_STACK_STATUSES), so an isStackBusyError here is
// only ever a concurrent republish. On that race we wait the other task's
// operation out and retry our OWN UpdateStack, so this run's template — not
// merely the winner's — converges; `maxBusyRetries` bounds the wait.
async function convergeStackUpdate({
  stackName,
  templateBody,
  maxBusyRetries = 10,
  log = () => {},
  // Forwarded to the waitForStack calls and used to pace the busy retry
  // (production takes the defaults — tests inject a tiny interval).
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs,
}) {
  for (let attempt = 0; ; attempt++) {
    // The stack as it stands immediately before our own UpdateStack: it is the
    // `prior` for the converge wait, and it is what a no-op converge returns.
    // Read per attempt, so a stack that was still being created when this run
    // started is reported at the state our update actually meets.
    const preUpdate = await describeStack({ stackName });
    if (preUpdate == null)
      throw new Error(
        `Stack '${stackName}' does not exist (deleted or never created)`
      );
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
      // DescribeStacks is eventually consistent, so a read taken the instant
      // CloudFormation rejects an UpdateStack as busy can still show the
      // pre-operation status — which would settle the wait below on the spot
      // and spin the loop through its whole retry budget in no time. One poll
      // interval of quiet first, so the wait reads the operation in flight.
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const current = (await describeStack({ stackName })) || preUpdate;
      log(
        `Stack '${stackName}' is busy with another operation ` +
          `(${current.StackStatus}); waiting for it to settle, then retrying.`
      );
      // No `prior`: nothing this run has started yet, so every read is real. A
      // stale/early wake is safe — the retry's UpdateStack simply throws busy
      // again and we wait once more.
      await waitForStack({
        stackName,
        desiredStatus: settleStatusFor(current.StackStatus),
        pollIntervalMs,
        timeoutMs,
      });
      continue;
    }
    // "No updates are to be performed" — the template already converged.
    if (!started) {
      log(`Stack '${stackName}' is already up to date.`);
      return preUpdate;
    }
    log(`Updating stack '${stackName}'...`);
    // Our own update is in flight. `prior` (the pre-update read) stops an
    // eventually-consistent pre-op DescribeStacks from resolving the wait
    // early; desiredStatus UPDATE_COMPLETE makes a rollback settling at
    // UPDATE_ROLLBACK_COMPLETE hit the terminal-status throw rather than be
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

// Cache-Control tier for a published-dashboard object key. The entry page and
// baked config must revalidate on every request (a fronting cache we cannot
// invalidate may otherwise pin an old release for a day); two classes are
// immutable because their names are content-addressed by construction — the
// webpack output, whose filenames carry a content hash (pinned by
// tests/unit/webpackHashedOutput.spec.js), and plugin uploads under
// assets/<mission>/<subdir>/uploads/, which the upload router names
// crypto.randomUUID() and never overwrites (API/Backend/Upload/uploadRouter.js).
// Everything else — the keys that really do change in place on republish —
// falls back to a short TTL.
function cacheControlForKey(key) {
  if (
    key === "index.html" ||
    key === "build/index.html" ||
    /^Missions\/[^/]+\/config\.json$/.test(key)
  )
    return "no-cache";
  // The uploads shape mirrors ASSETS_UPLOAD_KEY in src/pre/uploadKey.ts:
  // exactly two segments between "assets/" and "/uploads/", so a lookalike
  // such as "assets/uploads/x.png" is not mistaken for the writer's shape.
  if (
    /^build\/static\/(js|css|media)\//.test(key) ||
    /^assets\/[^/]+\/[^/]+\/uploads\//.test(key)
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
// (optionally prefixed). `filter` receives the prefixed key and returning
// false leaves that file out of the upload and out of the count. Returns the
// number of files uploaded.
async function uploadDirectory({
  bucket,
  dir,
  prefix = "",
  concurrency = 8,
  filter,
}) {
  const { s3 } = getClients();
  const files = walkDirectory(dir)
    .map((file) => ({ ...file, key: `${prefix}${file.key}` }))
    .filter((file) => (filter ? filter(file.key) : true));
  let index = 0;
  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.key,
          Body: fs.createReadStream(file.absolute),
          // An explicit length keeps the streaming PUT retryable by the
          // SDK (an unknown-length stream is sent unsigned/non-retryable,
          // so one network blip would fail the whole publish).
          ContentLength: fs.statSync(file.absolute).size,
          ContentType: contentTypeForFile(file.absolute),
          CacheControl: cacheControlForKey(file.key),
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

// Invalidates CloudFront paths so an updated dashboard is served
// immediately. Our own Cache-Control tiers already cover most of it —
// index.html and config.json revalidate every request, and hashed bundles
// arrive under new names — so this is what closes the gap for the short-TTL
// tier and for any edge that ignores those headers.
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
          // x-amz-meta-* are lost unless restated here. Nothing sets those
          // today (the upload router writes ContentType alone), but a future
          // gzipped object would have to carry its Content-Encoding across.
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

// Same-key copies a single object if it exists in the source bucket.
// Returns true when copied, false when the source object is absent.
async function copyObjectIfExists({ sourceBucket, destBucket, key }) {
  const { s3 } = getClients();
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: key,
        CopySource: buildCopySource(sourceBucket, key),
        MetadataDirective: "REPLACE",
        ContentType: contentTypeForFile(key),
        CacheControl: cacheControlForKey(key),
      })
    );
    return true;
  } catch (err) {
    if (
      err.name === "NoSuchKey" ||
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404
    )
      return false;
    throw err;
  }
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
// (provisioned by PR 11). Throws when configuration is missing or RunTask
// fails — callers record the error on the deployment row.
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
  settleStatusFor,
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
  copyObjectIfExists,
  emptyBucket,
  requireEnv,
  runPublishTask,
};
