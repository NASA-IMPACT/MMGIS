/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 * Loading all required dependencies, libraries and packages
 **********************************************************/
const express = require("express");
const router = express.Router();

const logger = require("../../../logger");
const Deployments = require("../models/deployment");
const STATUS = Deployments.STATUS;
const { updateRefusalFor } = require("../updateRefusal");

const triggerWebhooks = require("../../Webhooks/processes/triggerwebhooks");

const provision = require("../../../../scripts/lib/aws-provision");
const { stackNameForDeployment } = require("../../../../scripts/lib/cfn-template");
const {
  rowStillOursForFailure,
} = require("../../../../scripts/lib/publish-flow");

// Webhook payload for a deployment row.
function webhookPayload(deployment) {
  return {
    id: deployment.id,
    name: deployment.name,
    mission: deployment.mission,
    status: deployment.status,
    cloudfront_url: deployment.cloudfront_url || null,
  };
}

// Merges a deployment row with its live CloudFormation stack status
// (DescribeStacks at read time — no reconcile job). A row in `deleting`
// whose stack no longer exists flips to `deleted`.
async function withLiveStatus(deployment) {
  const row = deployment.toJSON();
  row.stack_status = null;
  if (row.stack_name == null) return row;
  // Deleted rows are history — never describe their (long-gone) stacks.
  if (row.status === STATUS.DELETED) return row;
  try {
    const stack = await provision.describeStack({
      stackName: row.stack_name,
    });
    if (stack != null) {
      row.stack_status = stack.StackStatus;
      if (stack.StackStatusReason != null)
        row.stack_status_reason = stack.StackStatusReason;
    } else if (row.status === STATUS.DELETING) {
      await deployment.update({ status: STATUS.DELETED });
      row.status = STATUS.DELETED;
    }
  } catch (err) {
    // Live status is best-effort; report the failure rather than erroring
    // the whole listing (e.g. missing AWS credentials).
    row.stack_status_error = err.message;
  }
  return row;
}

// POST /api/deployments/publish { mission, name }
// Inserts a `provisioning` row, starts the ECS publish task, and returns
// immediately. The task (scripts/publish-static.js) does the long-running
// bake/build/provision/upload work and writes the terminal status.
router.post("/publish", async function (req, res) {
  try {
    const mission = req.body.mission;
    const name = req.body.name;
    if (mission == null || mission === "") {
      res.send({ status: "failure", message: "'mission' is required." });
      return;
    }

    const deployment = await Deployments.create({
      name: name != null && name !== "" ? name : mission,
      mission: mission,
      created_by: req.user || null,
      status: STATUS.PROVISIONING,
    });
    await deployment.update({
      stack_name: stackNameForDeployment(deployment.id),
    });

    // Fire-and-forget: a RunTask failure marks the row failed with the
    // error, never crashes the request (which has already returned). The
    // failure lands only while the row is still this request's — a Delete or
    // a task that got the dashboard live owns the status from then on.
    provision
      .runPublishTask({ deploymentId: deployment.id, action: "publish" })
      .catch((err) => {
        logger(
          "error",
          `Failed to start publish task for deployment ${deployment.id}.`,
          "deployments",
          null,
          err
        );
        Deployments.update(
          {
            status: STATUS.FAILED,
            last_error: `Failed to start publish task: ${err.message}`,
          },
          { where: { id: deployment.id, ...rowStillOursForFailure(STATUS) } }
        ).catch(() => {});
      });

    triggerWebhooks("deploymentPublish", webhookPayload(deployment));

    res.send({
      status: "success",
      deployment_id: deployment.id,
      body: { deployment: deployment.toJSON() },
    });
  } catch (err) {
    logger("error", "Failed to publish deployment.", req.originalUrl, req, err);
    res.send({ status: "failure", message: "Failed to publish deployment." });
  }
});

// POST /api/deployments/:id/update
// Re-bakes against the mission's current configuration, converges the
// CloudFormation stack (re-baking the current dashboards password into the
// auth Function), then replaces the bundle in the existing bucket — same
// stack, same URL.
router.post("/:id/update", async function (req, res) {
  try {
    const deployment = await Deployments.findByPk(req.params.id);
    if (deployment == null) {
      res.send({ status: "failure", message: "Deployment not found." });
      return;
    }
    // Read the live stack alongside the row (this also flips a `deleting` row
    // whose stack is already gone to `deleted`).
    const row = await withLiveStatus(deployment);
    const refusal = updateRefusalFor(row, STATUS);
    if (refusal != null) {
      res.status(409).send({ status: "failure", message: refusal.message });
      return;
    }

    // Claim the row conditionally on the status AND the `updatedAt` the
    // refusal was judged against, both read moments ago from the same row:
    // two clicks race here without it, and both would start a task against the
    // same stack. A claim moves `updatedAt`, so even two clicks on a row that
    // already reads `updating` — where the status alone matches either way —
    // leave only the first one a row to write.
    const [claimed] = await Deployments.update(
      { status: STATUS.UPDATING, last_error: null },
      {
        where: {
          id: deployment.id,
          status: row.status,
          updatedAt: row.updatedAt,
        },
      }
    );
    if (claimed === 0) {
      res
        .status(409)
        .send({ status: "failure", message: "Deployment is already updating" });
      return;
    }
    // The claim wrote the row, not this instance; carry the new status onto it
    // so the webhook and the response body report what the row now holds.
    deployment.set({ status: STATUS.UPDATING, last_error: null });

    provision
      .runPublishTask({ deploymentId: deployment.id, action: "update" })
      .catch((err) => {
        logger(
          "error",
          `Failed to start update task for deployment ${deployment.id}.`,
          "deployments",
          null,
          err
        );
        Deployments.update(
          {
            status: STATUS.FAILED,
            last_error: `Failed to start update task: ${err.message}`,
          },
          { where: { id: deployment.id, ...rowStillOursForFailure(STATUS) } }
        ).catch(() => {});
      });

    triggerWebhooks("deploymentUpdate", webhookPayload(deployment));

    res.send({
      status: "success",
      deployment_id: deployment.id,
      body: { deployment: deployment.toJSON() },
    });
  } catch (err) {
    logger("error", "Failed to update deployment.", req.originalUrl, req, err);
    res.send({ status: "failure", message: "Failed to update deployment." });
  }
});

// Empties the deployment's bucket (if any) and issues DeleteStack.
// Best-effort and not awaited by the route: failures are logged and recorded
// in last_error so the Delete affordance can retry.
//
// The publish task writes settings.bucket only at the very end, so a delete
// fired after CREATE_COMPLETE but before that write would otherwise skip
// emptyBucket and leave a non-empty bucket that blocks DeleteStack
// (CloudFormation can't remove a non-empty bucket). Fall back to the stack's
// BucketName output, which is the source of truth and is populated exactly in
// that window.
async function teardownDeployment(deployment) {
  try {
    let bucket =
      deployment.settings != null ? deployment.settings.bucket : null;
    if (bucket == null && deployment.stack_name != null) {
      const stack = await provision.describeStack({
        stackName: deployment.stack_name,
      });
      if (stack != null)
        bucket = provision.getStackOutputs(stack).BucketName || null;
    }
    if (bucket != null) await provision.emptyBucket({ bucket });
    if (deployment.stack_name != null)
      await provision.deleteStack({ stackName: deployment.stack_name });
  } catch (err) {
    logger(
      "error",
      `Failed to tear down deployment ${deployment.id}.`,
      "deployments",
      null,
      err
    );
    Deployments.update(
      { last_error: `Teardown failed: ${err.message}` },
      { where: { id: deployment.id } }
    ).catch(() => {});
  }
}

// DELETE /api/deployments/:id
// Marks the row `deleting`, then inline (no spawned task) empties the
// bucket and issues DeleteStack, returning immediately — CloudFormation
// handles the multi-step teardown async and the row flips to `deleted` on
// the next read once DescribeStacks 404s. Idempotent: re-deleting retries
// a stuck teardown.
router.delete("/:id", async function (req, res) {
  try {
    const deployment = await Deployments.findByPk(req.params.id);
    if (deployment == null) {
      res.send({ status: "failure", message: "Deployment not found." });
      return;
    }

    await deployment.update({ status: STATUS.DELETING, last_error: null });

    // Teardown continues after the response; failures land in last_error
    // and the Delete affordance retries.
    teardownDeployment(deployment);

    triggerWebhooks("deploymentDelete", webhookPayload(deployment));

    res.send({
      status: "success",
      deployment_id: deployment.id,
      body: { deployment: deployment.toJSON() },
    });
  } catch (err) {
    logger("error", "Failed to delete deployment.", req.originalUrl, req, err);
    res.send({ status: "failure", message: "Failed to delete deployment." });
  }
});

// GET /api/deployments
// All rows, each merged with its live stack status.
router.get("/", async function (req, res) {
  try {
    const deployments = await Deployments.findAll({
      order: [["id", "DESC"]],
    });
    const merged = await Promise.all(deployments.map(withLiveStatus));
    res.send({ status: "success", body: { deployments: merged } });
  } catch (err) {
    logger("error", "Failed to list deployments.", req.originalUrl, req, err);
    res.send({ status: "failure", message: "Failed to list deployments." });
  }
});

// GET /api/deployments/:id
router.get("/:id", async function (req, res) {
  try {
    const deployment = await Deployments.findByPk(req.params.id);
    if (deployment == null) {
      res.send({ status: "failure", message: "Deployment not found." });
      return;
    }
    const merged = await withLiveStatus(deployment);
    res.send({ status: "success", body: { deployment: merged } });
  } catch (err) {
    logger("error", "Failed to get deployment.", req.originalUrl, req, err);
    res.send({ status: "failure", message: "Failed to get deployment." });
  }
});

module.exports = { router, teardownDeployment, withLiveStatus };
