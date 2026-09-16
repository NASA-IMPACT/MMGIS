/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 * Loading all required dependencies, libraries and packages
 **********************************************************/
const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const logger = require("../../../logger");
const Deployments = require("../models/deployment");
const STATUS = Deployments.STATUS;

const triggerWebhooks = require("../../Webhooks/processes/triggerwebhooks");

const provision = require("../../../../scripts/lib/aws-provision");
const { stackNameForDeployment } = require("../../../../scripts/lib/cfn-template");

const TASK_STATE = provision.TASK_STATE;
const IN_FLIGHT_STATUSES = Deployments.IN_FLIGHT_STATUSES;

// What a read reports as `publish_task_state` on an in-flight row when the
// row has no recorded task ARN or DescribeTasks could not answer; otherwise
// the value is one of TASK_STATE as answered by ECS. Absent on every other
// row.
const UNKNOWN_TASK_STATE = "unknown";

// "publish" for a row being provisioned, "update" for one being updated.
function taskVerb(status) {
  return status === STATUS.PROVISIONING ? "publish" : "update";
}

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

// The body of a refused request. The Configure SPA's calls.api ignores HTTP
// status codes and dispatches on `status`, so the reason and the message
// ride in the body; the routes also send it with a 409 for other clients.
// The row rides along so the SPA can watch it without another fetch.
function refusal(reason, message, deployment) {
  return {
    status: "failure",
    reason,
    message,
    deployment_id: deployment.id,
    body: { deployment: deployment.toJSON() },
  };
}

// Starts the publish task for a row and remembers its ARN. Fire-and-forget
// from the routes, whose responses have already gone out: a RunTask failure
// marks the row failed with the error, unless a Delete has claimed the row
// in the meantime (its next status is then the delete flow's to decide),
// while a failure to record the ARN only logs, because the task is running
// and will report its own result.
function startPublishTask(deployment, action) {
  return provision
    .runPublishTask({ deploymentId: deployment.id, action })
    .then(
      (taskArn) =>
        taskArn == null
          ? null
          : Deployments.recordPublishTaskArn(deployment.id, taskArn).catch(
              (err) => {
                logger(
                  "warn",
                  `Started ${action} task ${taskArn} for deployment ${deployment.id} but could not record it.`,
                  "deployments",
                  null,
                  err
                );
              }
            ),
      (err) => {
        logger(
          "error",
          `Failed to start ${action} task for deployment ${deployment.id}.`,
          "deployments",
          null,
          err
        );
        return Deployments.update(
          {
            status: STATUS.FAILED,
            last_error: `Failed to start ${action} task: ${err.message}`,
          },
          {
            where: {
              id: deployment.id,
              status: { [Op.in]: IN_FLIGHT_STATUSES },
            },
          }
        ).catch(() => {});
      }
    );
}

// Null when a Publish may proceed. A row for the mission that is neither
// deleted nor being deleted means a dashboard already exists, and a second
// one is a separate stack with its own URL, so the request is refused with
// reason `exists` unless it passes `force: true` (the Deployments page asks
// the admin first). A dashboard mid-delete does not count: publishing is
// how its replacement gets made.
async function publishRefusal({ mission, force }) {
  if (force === true) return null;
  const existing = await Deployments.findOne({
    where: {
      mission,
      status: { [Op.notIn]: [STATUS.DELETED, STATUS.DELETING] },
    },
    order: [["id", "DESC"]],
  });
  if (existing == null) return null;
  return refusal(
    "exists",
    `A dashboard for ${mission} already exists (${existing.name}, ${
      existing.cloudfront_url || existing.status
    }).`,
    existing
  );
}

// The refusal when a compare-and-set claimed zero rows and the row is not in
// any status the caller has words for: it changed under the request, or it
// is gone. `current` is the re-read row, null when it no longer exists;
// `deployment` is the row the request was made on.
function conflictRefusal(deployment, current) {
  if (current == null)
    return refusal(
      "conflict",
      `'${deployment.name}' no longer exists. Refresh the Deployments page.`,
      deployment
    );
  return refusal(
    "conflict",
    `'${current.name}' changed to ${current.status} while this request was in flight. Refresh the Deployments page and try again.`,
    current
  );
}

// The refusal for an Update of a row that could not be claimed, worded for
// the status the row is in.
function updateRefusalFor(deployment) {
  const name = deployment.name;
  switch (deployment.status) {
    case STATUS.PROVISIONING:
      return refusal(
        "in_progress",
        `A publish is already running for '${name}'. Wait for it to finish (the Deployments page shows its progress), then update.`,
        deployment
      );
    case STATUS.UPDATING:
      return refusal(
        "in_progress",
        `An update is already running for '${name}'. Wait for it to finish (the Deployments page shows its progress), then update again.`,
        deployment
      );
    case STATUS.DELETING:
      return refusal(
        "deleting",
        `'${name}' is being deleted and cannot be updated. Once the delete finishes, publish the mission again.`,
        deployment
      );
    case STATUS.DELETED:
      return refusal(
        "deleted",
        `'${name}' has been deleted and cannot be updated. Publish the mission again to create a new dashboard.`,
        deployment
      );
    default:
      return conflictRefusal(deployment, deployment);
  }
}

// Claims the row for an update with one conditional write: the row moves to
// `updating` only from a resting status (published or failed), and the
// previous run's task ARN is cleared so a read before the new task starts
// cannot see a stopped task. Two Update clicks race here and exactly one
// claims the row. Resolves null when claimed, otherwise the refusal for the
// status the row is actually in.
async function claimForUpdate(deployment) {
  const [claimed] = await Deployments.update(
    {
      status: STATUS.UPDATING,
      last_error: null,
      settings: { ...(deployment.settings || {}), publish_task_arn: null },
    },
    {
      where: {
        id: deployment.id,
        status: {
          [Op.notIn]: [
            STATUS.PROVISIONING,
            STATUS.UPDATING,
            STATUS.DELETING,
            STATUS.DELETED,
          ],
        },
      },
    }
  );
  if (claimed > 0) return null;
  const current = await Deployments.findByPk(deployment.id);
  if (current == null) return conflictRefusal(deployment, null);
  return updateRefusalFor(current);
}

// Claims the row for a delete with one conditional write: the row moves to
// `deleting` only from the status the delete gate judged, so a row that
// changed under the request (its task reported, another admin acted) is
// refused as a conflict rather than torn down on a stale verdict. Resolves
// null when claimed, otherwise the refusal.
async function claimForDelete(deployment) {
  const [claimed] = await Deployments.update(
    { status: STATUS.DELETING, last_error: null },
    { where: { id: deployment.id, status: deployment.status } }
  );
  if (claimed > 0) return null;
  return conflictRefusal(deployment, await Deployments.findByPk(deployment.id));
}

// Null when a Delete may proceed; the refusal when the row's publish task is
// confirmed alive. A row with no recorded task, a task that has stopped or
// been forgotten, and an unanswered DescribeTasks all let the delete
// through: the gate stops a teardown under a task that is provably still
// working, and never holds a row hostage to a question ECS cannot answer.
// The task's own terminal writes skip a row a Delete has claimed.
async function deleteRefusal(deployment) {
  if (!IN_FLIGHT_STATUSES.includes(deployment.status)) return null;
  const taskArn =
    deployment.settings != null ? deployment.settings.publish_task_arn : null;
  if (taskArn == null) return null;
  let task;
  try {
    task = await provision.describePublishTask({ taskArn });
  } catch (err) {
    logger(
      "warn",
      `Could not confirm publish task ${taskArn} for deployment ${deployment.id} before delete; allowing the delete.`,
      "deployments",
      null,
      err
    );
    return null;
  }
  if (task.state !== TASK_STATE.ALIVE) return null;
  return refusal(
    "in_progress",
    `The ${taskVerb(deployment.status)} task for '${
      deployment.name
    }' is still running (${task.detail}). Wait for it to finish, then delete.`,
    deployment
  );
}

// The `last_error` for a row whose publish task exited without reporting,
// naming the next step the row's status allows: a `provisioning` row may
// have no stack yet, so Update (which needs one) is not offered for it.
function publishTaskExitedMessage(status, detail) {
  const nextStep =
    status === STATUS.PROVISIONING
      ? "Delete this row and publish again."
      : "Use Update to retry, or Delete and publish again.";
  return `The ${taskVerb(
    status
  )} task exited before reporting: ${detail}. ${nextStep}`;
}

// How long after a row is claimed a MISSING answer from ECS is read as the
// task not being listed yet rather than as a task that ran and was
// forgotten: ECS lists a task within moments of RunTask returning, and
// forgets a stopped one only about an hour after it stops.
const MISSING_TASK_GRACE_MS = 2 * 60 * 1000;

// True when the row was claimed (its `updatedAt`) less than `ms` ago.
function claimedWithin(row, ms, now) {
  return (
    row.updatedAt != null && now - new Date(row.updatedAt).getTime() < ms
  );
}

// Adds `publish_task_state` (and `publish_task_detail` or
// `publish_task_error`) to an in-flight row and reconciles a task that died
// without reporting. Only a definitive stopped or missing answer from ECS
// flips the row to `failed`, and that write is pinned to the row still
// carrying the ARN whose death was observed, so neither a task that reported
// in the meantime nor a new task an Update has since started is
// overwritten; a row with no recorded task ARN, or one ECS could not be
// asked about, stays as it is and reads as `unknown`. `now` is the time the
// row's age is judged against, defaulting to the current time. `rereads`
// bounds how many times a row that moved on under the flip is re-read and
// reconciled in turn.
async function reconcilePublishTask(row, now = Date.now(), rereads = 1) {
  if (!IN_FLIGHT_STATUSES.includes(row.status)) return;
  const taskArn = row.settings != null ? row.settings.publish_task_arn : null;
  if (taskArn == null) {
    // Neither the route nor the task itself recorded an ARN: the task has
    // not reached its first line, or never will. Nothing definitive.
    row.publish_task_state = UNKNOWN_TASK_STATE;
    return;
  }
  try {
    const task = await provision.describePublishTask({ taskArn });
    if (
      task.state === TASK_STATE.MISSING &&
      claimedWithin(row, MISSING_TASK_GRACE_MS, now)
    ) {
      row.publish_task_state = UNKNOWN_TASK_STATE;
      row.publish_task_error = "ECS does not list the task yet";
      return;
    }
    row.publish_task_state = task.state;
    row.publish_task_detail = task.detail;
    if (task.state === TASK_STATE.ALIVE) return;
    const lastError = publishTaskExitedMessage(row.status, task.detail);
    const flipped = await Deployments.markPublishTaskExited(
      row.id,
      taskArn,
      lastError
    );
    if (flipped > 0) {
      row.status = STATUS.FAILED;
      row.last_error = lastError;
      return;
    }
    // The row moved on between the list read and this write (the task
    // reported, or an Update re-claimed it): serve what is there now rather
    // than the stale in-flight row, reconciled in turn so a new task an
    // Update has started reads as in flight rather than as a row with no
    // task state.
    const fresh = await Deployments.findByPk(row.id);
    delete row.publish_task_state;
    delete row.publish_task_detail;
    if (fresh == null) return;
    Object.assign(row, fresh.toJSON());
    if (rereads > 0) await reconcilePublishTask(row, now, rereads - 1);
  } catch (err) {
    // Best-effort, like the stack status: an unanswered question is
    // reported on the row, never turned into a verdict.
    row.publish_task_state = UNKNOWN_TASK_STATE;
    row.publish_task_error = err.message;
  }
}

// Merges a deployment row with the live state of its publish task and of
// its CloudFormation stack (DescribeTasks and DescribeStacks at read time,
// no reconcile job). A row in `deleting` whose stack no longer exists flips
// to `deleted`.
async function withLiveStatus(deployment) {
  const row = deployment.toJSON();
  row.stack_status = null;
  // Deleted rows are history: never describe their long-gone stacks or tasks.
  if (row.status === STATUS.DELETED) return row;
  await reconcilePublishTask(row);
  if (row.stack_name == null) return row;
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

// POST /api/deployments/publish { mission, name, force }
// Inserts a `provisioning` row, starts the ECS publish task, and returns
// immediately. The task (scripts/publish-static.js) does the long-running
// bake/build/provision/upload work and writes the terminal status. A second
// dashboard for a mission needs `force: true`.
router.post("/publish", async function (req, res) {
  try {
    const mission = req.body.mission;
    const name = req.body.name;
    if (mission == null || mission === "") {
      res.send({ status: "failure", message: "'mission' is required." });
      return;
    }

    const refused = await publishRefusal({ mission, force: req.body.force });
    if (refused != null) {
      res.status(409).send(refused);
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

    startPublishTask(deployment, "publish");

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
// Claims the row, then re-bakes against the mission's current configuration,
// replaces the bundle in the existing dashboard bucket, and converges the
// CloudFormation stack via UpdateStack (re-baking the current dashboard
// password into the auth Function): same stack, same URL. A row that is
// already in flight, deleting or deleted is refused with the reason.
router.post("/:id/update", async function (req, res) {
  try {
    const deployment = await Deployments.findByPk(req.params.id);
    if (deployment == null) {
      res.send({ status: "failure", message: "Deployment not found." });
      return;
    }

    const refused = await claimForUpdate(deployment);
    if (refused != null) {
      res.status(409).send(refused);
      return;
    }
    await deployment.reload();

    startPublishTask(deployment, "update");

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
// Refuses while the row's publish task is confirmed alive; otherwise claims
// the row as `deleting` from the status just judged, then inline (no spawned
// task) empties the bucket and issues DeleteStack, returning immediately.
// CloudFormation handles the multi-step teardown async and the row flips to
// `deleted` on the next read once DescribeStacks 404s. Idempotent:
// re-deleting a `deleting` row retries a stuck teardown.
router.delete("/:id", async function (req, res) {
  try {
    const deployment = await Deployments.findByPk(req.params.id);
    if (deployment == null) {
      res.send({ status: "failure", message: "Deployment not found." });
      return;
    }

    const refused =
      (await deleteRefusal(deployment)) || (await claimForDelete(deployment));
    if (refused != null) {
      res.status(409).send(refused);
      return;
    }
    await deployment.reload();

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
// All rows, each merged with its live task and stack status.
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

module.exports = {
  router,
  teardownDeployment,
  startPublishTask,
  reconcilePublishTask,
  publishRefusal,
  claimForUpdate,
  deleteRefusal,
  claimForDelete,
};
