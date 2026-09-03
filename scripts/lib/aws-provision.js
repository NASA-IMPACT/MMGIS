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
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const {
  CloudFrontClient,
  CreateInvalidationCommand,
} = require("@aws-sdk/client-cloudfront");

// The classifier for plugin-upload object keys, taken from the router that
// writes them.
const { ASSETS_UPLOAD_KEY } = require("../../API/Backend/Upload/validate");

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

// What a wait for "whatever the other task settles at" accepts. DELETE_COMPLETE
// is absent because DescribeStacks by name answers "does not exist" for a
// deleted stack, so no poll can ever read that status back.
const SETTLED_STACK_STATUSES = TERMINAL_STACK_STATUSES.filter(
  (status) => status !== "DELETE_COMPLETE"
);

// Statuses a stack can neither be reused at nor driven forward from: it can
// only be deleted (or, for a couple, have a rollback continued) — never
// updated in place. Reaching one earns the actionable "delete and republish"
// guidance BEFORE any busy classification, so a permanently-wedged stack is
// never mistaken for one another task is merely busy updating.
//   The *_FAILED family and the create-rollback pair (CREATE_FAILED,
//     ROLLBACK_IN_PROGRESS, ROLLBACK_COMPLETE) are dead ends that only an
//     operator or a delete clears.
//   DELETE_IN_PROGRESS - the stack and its bucket are on their way out, so
//     there is nothing to publish onto.
//   REVIEW_IN_PROGRESS - a change set created the stack shell and was never
//     executed, so it holds no bucket or distribution to converge onto.
// Three of these end in _IN_PROGRESS while leading nowhere but a delete, which
// is why an _IN_PROGRESS suffix alone never means "another task is busy".
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
  "REVIEW_IN_PROGRESS",
];

// Throws the actionable "delete and republish" guidance when `stack` rests in
// one of UNUSABLE_STACK_STATUSES.
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

// The status named by the ValidationError CloudFormation raises when a stack
// is busy with an operation genuinely IN FLIGHT ("Stack:arn:... is in
// UPDATE_IN_PROGRESS state and can not be updated."), or null for any other
// error. Two republish clicks start two ECS tasks and the loser lands here — a
// race to wait out, not a failure. CloudFormation reuses that same wording for
// delete-only statuses, which are not another task updating, so the status has
// to be both *_IN_PROGRESS and absent from UNUSABLE_STACK_STATUSES. Same error
// NAME as the no-op and does-not-exist cases, so the message stays the only
// discriminator.
function busyStatusOf(err) {
  if (err == null || err.name !== "ValidationError") return null;
  const named = (err.message || "").match(
    /is in ([A-Z_]+) state and can not be updated/
  );
  if (named == null) return null;
  const status = named[1];
  if (!status.endsWith("_IN_PROGRESS")) return null;
  return UNUSABLE_STACK_STATUSES.indexOf(status) === -1 ? status : null;
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
  // boilerplate "User Initiated" CloudFormation stamps, so one can't get
  // attached to a later terminal failure message.
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
      if (
        stack.StackStatusReason &&
        stack.StackStatusReason !== "User Initiated"
      )
        lastReason = stack.StackStatusReason;
      if (desired.indexOf(stack.StackStatus) !== -1) return stack;
      if (TERMINAL_STACK_STATUSES.indexOf(stack.StackStatus) !== -1)
        throw new Error(
          `Stack '${stackName}' reached terminal status '${stack.StackStatus}'` +
            (lastReason ? `: ${lastReason}` : "")
        );
    }
    if (Date.now() - startedAt > timeoutMs) {
      const timedOut = new Error(
        `Timed out waiting for stack '${stackName}' to ${desiredLabel} (last status '${stack.StackStatus}')` +
          (lastReason ? `: ${lastReason}` : "")
      );
      // Marks the one rejection that means "the clock ran out", so a caller
      // running this wait on a shared budget can say whose clock it was.
      timedOut.timedOut = true;
      throw timedOut;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Converges `templateBody` onto an existing stack via UpdateStack and waits
// for our update to finish. Returns the converged Stack, or the latest read
// of it when there is nothing to update. The stack is read fresh at the top of
// every attempt, so the caller passes only its name.
//
// Every attempt starts on a stack assertStackUsable has cleared, so a busy
// rejection here is only ever a concurrent republish. On that race we
// wait the other task's operation out and retry our OWN UpdateStack, so this
// run's template — not merely the winner's — converges; `maxBusyRetries` bounds
// how many rounds that takes and `deadlineMs` how long they may take in total.
async function convergeStackUpdate({
  stackName,
  templateBody,
  maxBusyRetries = 10,
  deadlineMs = 45 * 60 * 1000,
  log = () => {},
  // Forwarded to both waitForStack calls, and used as the pause between a busy
  // rejection and the retry (production takes the defaults — tests inject a
  // tiny interval).
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs,
}) {
  const startedAt = Date.now();
  // What is left of the whole convergence's budget, so retries share one
  // deadline instead of each getting a fresh timeout. Floored at zero.
  const remainingMs = () => Math.max(0, deadlineMs - (Date.now() - startedAt));
  const deadlineError = () =>
    new Error(
      `Stack '${stackName}' did not converge within its ${deadlineMs}ms ` +
        "deadline — another operation may be stuck; try again shortly."
    );
  // Runs one waitForStack on what is left of the shared budget, capped by a
  // caller's own `timeoutMs`. An exhausted budget, and a wait the budget cut
  // short, both surface as the deadline rather than as one poll's timeout —
  // so the row names the deadline it actually hit.
  const waitWithinDeadline = async (options) => {
    const left = remainingMs();
    if (left === 0) throw deadlineError();
    const budgetMs = timeoutMs != null ? Math.min(timeoutMs, left) : left;
    try {
      return await waitForStack({ ...options, timeoutMs: budgetMs });
    } catch (err) {
      if (err.timedOut && budgetMs === left) throw deadlineError();
      throw err;
    }
  };
  for (let attempt = 0; ; attempt++) {
    if (remainingMs() === 0) throw deadlineError();
    // The read just before our own UpdateStack: passed as `prior` to the
    // converge wait, and returned as-is when there is nothing to update. It is
    // taken per attempt because another task can converge, wedge, or delete the
    // stack while this one bakes and builds, and a wait-out can settle on a
    // delete-only status. A stack that is gone is gone — publishing again is
    // what recreates it, so there is nothing here to converge onto.
    const preUpdate = await describeStack({ stackName });
    if (preUpdate == null)
      throw new Error(
        `Stack '${stackName}' does not exist (deleted or never created)`
      );
    // A delete-only status earns the guidance rather than an UpdateStack
    // CloudFormation would reject with its own opaque wording.
    assertStackUsable({ stackName, stack: preUpdate });
    let started;
    try {
      started = await updateStack({ stackName, templateBody });
    } catch (err) {
      const busyStatus = busyStatusOf(err);
      if (busyStatus == null) throw err;
      if (attempt >= maxBusyRetries)
        throw new Error(
          `Stack '${stackName}' stayed busy after ${maxBusyRetries + 1} ` +
            "UpdateStack attempts — another operation may be stuck; try again shortly."
        );
      // The rejection names the status the other operation is holding, which is
      // fresher than the read taken before it.
      log(
        `Stack '${stackName}' is busy with another operation ` +
          `(${busyStatus}); waiting for it to settle, then retrying.`
      );
      // Wait on whatever status the other operation settles at (a rollback
      // settles at UPDATE_ROLLBACK_COMPLETE, which is still updatable) and let
      // the next attempt read it back and judge it. The busy rejection is
      // itself proof an operation is in flight, so the read taken before it is
      // stale: pass it as `prior` and poll through reads that still match it.
      await waitWithinDeadline({
        stackName,
        desiredStatus: SETTLED_STACK_STATUSES,
        prior: {
          status: preUpdate.StackStatus,
          lastUpdatedTime: preUpdate.LastUpdatedTime,
        },
        pollIntervalMs,
      });
      // The winner's operation only just settled; this pause is deliberate,
      // giving CloudFormation a beat before we ask it to accept ours.
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
    return await waitWithinDeadline({
      stackName,
      desiredStatus: "UPDATE_COMPLETE",
      prior: {
        status: preUpdate.StackStatus,
        lastUpdatedTime: preUpdate.LastUpdatedTime,
      },
      pollIntervalMs,
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
// Everything else falls back to a short TTL. scripts/build.js copyPublicFolder
// copies public/ into build/ verbatim, so nothing arriving that way is
// content-hashed either (tests/unit/publicHasNoHashedDirs.spec.js). The Cesium
// tree is the bulk of that, and the short tier is where it belongs: its
// filenames are stable and their contents change on a release bump.
//
// Neither cacheable tier says "public", which keeps these password-gated
// responses out of shared caches. What the tiers mean for a customer fronting
// the dashboard is in
// docs/infrastructure/serving-a-dashboard-from-your-domain.md.
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
    return "max-age=31536000, immutable";
  return "max-age=300";
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
// (optionally prefixed). `filter` receives the prefixed key — the same string
// cacheControlForKey is given — and keeps the file when it returns true.
// Returns the number of files uploaded.
async function uploadDirectory({
  bucket,
  dir,
  prefix = "",
  concurrency = 8,
  filter,
}) {
  const { s3 } = getClients();
  const files = filter
    ? walkDirectory(dir).filter((file) => filter(`${prefix}${file.key}`))
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

// Invalidates paths on our own distribution, the only one this reaches. Its
// cache policy (see the CachePolicyId in scripts/lib/cfn-template.js) leaves
// the entry page, the baked config and the fallback tier holdable at this
// edge; hashed bundles need nothing, arriving under new names, so the "/*"
// invalidation is what clears those tiers here. Any other edge in front of
// the dashboard is governed by the headers alone.
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

// The headers a copied object should carry. Content-Type comes from the
// CONTENT_TYPES mapping when the extension is one it names; otherwise the
// source object's own headers are read with HeadObject, which gives its
// Content-Type (octet-stream when it carries none) plus whichever of
// Content-Encoding, Content-Disposition and Content-Language it was stored
// with — headers a REPLACE copy would otherwise drop.
const COPIED_STORAGE_HEADERS = [
  "ContentEncoding",
  "ContentDisposition",
  "ContentLanguage",
];
async function copiedHeaders({ s3, sourceBucket, key }) {
  const mapped = CONTENT_TYPES[path.extname(key).toLowerCase()];
  if (mapped != null) return { ContentType: mapped };
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: sourceBucket, Key: key })
  );
  const headers = {
    ContentType: head.ContentType || "application/octet-stream",
  };
  COPIED_STORAGE_HEADERS.forEach((field) => {
    if (head[field]) headers[field] = head[field];
  });
  return headers;
}

// Same-key copies every object under `prefix` from sourceBucket into
// destBucket, giving each copy the Cache-Control tier for its key. COPY (the
// default) cannot set headers the source object never had, so that takes
// MetadataDirective: REPLACE, which rewrites the metadata of every key under
// the prefix — anything not restated alongside Content-Type is dropped, x-amz-
// meta-* included. The upload router writes Content-Type alone; a hand-placed
// object keeps the storage headers copiedHeaders restates for it. Returns the
// number of objects copied.
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
      const headers = await copiedHeaders({
        s3,
        sourceBucket,
        key: obj.Key,
      });
      await s3.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: obj.Key,
          CopySource: buildCopySource(sourceBucket, obj.Key),
          MetadataDirective: "REPLACE",
          ...headers,
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
  assertStackUsable,
  // convergeStackUpdate's own steps; exported for tests.
  updateStack,
  busyStatusOf,
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
