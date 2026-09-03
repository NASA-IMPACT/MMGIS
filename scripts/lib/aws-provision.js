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
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
];

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
      err.name === "ValidationError" ||
      (err.message || "").indexOf("does not exist") !== -1
    )
      return null;
    throw err;
  }
}

// Polls DescribeStacks until the stack reaches a terminal status.
// Resolves with the Stack object on success; throws on failure statuses,
// disappearance, or timeout.
async function waitForStack({
  stackName,
  desiredStatus = "CREATE_COMPLETE",
  pollIntervalMs = 15000,
  timeoutMs = 30 * 60 * 1000,
}) {
  const startedAt = Date.now();
  for (;;) {
    const stack = await describeStack({ stackName });
    if (stack == null)
      throw new Error(
        `Stack '${stackName}' does not exist (deleted or never created)`
      );
    if (stack.StackStatus === desiredStatus) return stack;
    if (TERMINAL_STACK_STATUSES.indexOf(stack.StackStatus) !== -1)
      throw new Error(
        `Stack '${stackName}' reached terminal status '${stack.StackStatus}'` +
          (stack.StackStatusReason ? `: ${stack.StackStatusReason}` : "")
      );
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(
        `Timed out waiting for stack '${stackName}' to reach '${desiredStatus}' (last status '${stack.StackStatus}')`
      );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
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
// (optionally prefixed). Returns the number of files uploaded.
async function uploadDirectory({ bucket, dir, prefix = "", concurrency = 8 }) {
  const { s3 } = getClients();
  const files = walkDirectory(dir);
  let index = 0;
  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${file.key}`,
          Body: fs.createReadStream(file.absolute),
          // An explicit length keeps the streaming PUT retryable by the
          // SDK (an unknown-length stream is sent unsigned/non-retryable,
          // so one network blip would fail the whole publish).
          ContentLength: fs.statSync(file.absolute).size,
          ContentType: contentTypeForFile(file.absolute),
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
    })
  );
}

// Invalidates CloudFront paths so an updated dashboard is served
// immediately (the distribution caches aggressively; hashed bundle
// names dodge it but index.html, config.json, and assets do not).
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
  TERMINAL_STACK_STATUSES,
  createStack,
  describeStack,
  waitForStack,
  getStackOutputs,
  deleteStack,
  contentTypeForFile,
  uploadDirectory,
  uploadFile,
  createInvalidation,
  copyPrefix,
  emptyBucket,
  requireEnv,
  runPublishTask,
};
