// Deployment status values, mirrored from the backend model
// (API/Backend/Deployments/models/deployment.js — a parity unit test
// keeps the two in sync). Configure code uses these instead of raw
// status string literals.
export const STATUS = Object.freeze({
  PROVISIONING: "provisioning",
  PUBLISHED: "published",
  UPDATING: "updating",
  DELETING: "deleting",
  DELETED: "deleted",
  FAILED: "failed",
});
export const TRANSITIONAL_STATUSES = Object.freeze([
  STATUS.PROVISIONING,
  STATUS.UPDATING,
  STATUS.DELETING,
]);

// Values of `publish_task_state` the page acts on, which the list endpoint
// sets on a row in `provisioning` or `updating` from ECS DescribeTasks:
// `alive` while the task runs, `unknown` when no task ARN is recorded for
// the row or ECS could not be asked (the row's `publish_task_error` says
// why). A task ECS reports as stopped or missing flips the row to `failed`
// on that same read, so the page never has to act on those answers.
export const PUBLISH_TASK_STATE = Object.freeze({
  ALIVE: "alive",
  UNKNOWN: "unknown",
});

// How long after a row is claimed the absence of a recorded task ARN is
// normal: the route records the ARN once RunTask returns and the task
// records its own once its container starts, and both take seconds.
export const PUBLISH_TASK_START_GRACE_MS = 60 * 1000;

// The way out of an alive task that never finishes, appended wherever the
// page says Delete is waiting on the task.
const STUCK_TASK_HINT =
  "If it looks stuck, stop the task in ECS; Delete becomes available once it stops.";

// Statuses under which a publish task may be running for the row.
export const IN_FLIGHT_STATUSES = Object.freeze([
  STATUS.PROVISIONING,
  STATUS.UPDATING,
]);

// "publish" for a row being provisioned, "update" for one being updated.
function taskVerb(deployment) {
  return deployment.status === STATUS.PROVISIONING ? "publish" : "update";
}

// Why Update is unavailable for the row, or null when it is available.
// Update re-bakes into the row's existing stack, so a failed row that never
// got one (no `stack_arn`) has nothing to update: the update task would
// only fail again and overwrite the row's informative error.
export function updateDisabledReason(deployment) {
  switch (deployment.status) {
    case STATUS.PROVISIONING:
      return "A publish is running for this dashboard. Update is available when it finishes.";
    case STATUS.UPDATING:
      return "An update is already running for this dashboard. Update is available when it finishes.";
    case STATUS.DELETING:
      return "This dashboard is being deleted and cannot be updated. Publish the mission again once the delete finishes.";
    case STATUS.DELETED:
      return "This dashboard has been deleted. Publish the mission again to create a new one.";
    case STATUS.FAILED:
      return deployment.stack_arn == null
        ? "This publish failed before its dashboard was created. Delete this row and publish again."
        : null;
    default:
      return null;
  }
}

// Why Delete is unavailable for the row, or null when it is available.
// Delete stays available on an in-flight row unless the publish task is
// confirmed alive, so a row whose task ECS cannot vouch for can still be
// cleared; the row text and the delete modal spell out that uncertainty.
export function deleteDisabledReason(deployment) {
  if (deployment.status === STATUS.DELETED) return "Already deleted.";
  if (
    IN_FLIGHT_STATUSES.includes(deployment.status) &&
    deployment.publish_task_state === PUBLISH_TASK_STATE.ALIVE
  )
    return `The ${taskVerb(
      deployment,
    )} task is running for this dashboard. Delete is available when it finishes. ${STUCK_TASK_HINT}`;
  return null;
}

// True when the row was claimed (its `updatedAt`) less than the start grace
// ago; a row with no claim time gets no grace.
function withinStartGrace(deployment, now) {
  return (
    deployment.updatedAt != null &&
    now - new Date(deployment.updatedAt).getTime() <
      PUBLISH_TASK_START_GRACE_MS
  );
}

// The notice for an in-flight row whose publish task could not be
// confirmed, as { text, tone, modalText }: tone "note" while the task is
// expected to be starting, "warning" once something is off, with what
// deleting now risks or what to do. `text` is shown under the row;
// `modalText` is the delete modal's wording, which adds what deleting now
// risks where the row text leaves it unsaid. Null when the task was
// confirmed or the row is not in flight. `now` is the time the row's age
// is judged against, defaulting to the current time.
export function publishTaskUnconfirmedNotice(deployment, now = Date.now()) {
  if (
    !IN_FLIGHT_STATUSES.includes(deployment.status) ||
    deployment.publish_task_state !== PUBLISH_TASK_STATE.UNKNOWN
  )
    return null;
  const verb = taskVerb(deployment);
  if (deployment.publish_task_error) {
    const text = `Could not confirm whether the ${verb} task is still running: ${deployment.publish_task_error}. Deleting now may race a live ${verb}.`;
    return { text, tone: "warning", modalText: text };
  }
  if (withinStartGrace(deployment, now)) {
    const text = `Starting the ${verb} task…`;
    return {
      text,
      tone: "note",
      modalText: `${text} Deleting now may race it once it starts.`,
    };
  }
  const text = `No ${verb} task was recorded for this row. If it stays this way, delete the deployment and publish again.`;
  return { text, tone: "warning", modalText: text };
}

// The visible text under an in-flight row describing its publish task, as
// { text, tone }: running since when (tone "note"), or why it could not be
// confirmed and what to do (see publishTaskUnconfirmedNotice). Null when
// the row is not in flight or reports no task state.
export function publishTaskNotice(deployment, now = Date.now()) {
  if (!IN_FLIGHT_STATUSES.includes(deployment.status)) return null;
  switch (deployment.publish_task_state) {
    case PUBLISH_TASK_STATE.ALIVE: {
      // updatedAt is the moment the row was claimed for this run, so it is
      // how long the task has had, and lets the admin judge a hang.
      const since = deployment.updatedAt
        ? ` since ${new Date(deployment.updatedAt).toLocaleString()}`
        : "";
      const ecsStatus = deployment.publish_task_detail
        ? ` (ECS status ${deployment.publish_task_detail})`
        : "";
      return {
        text: `The ${taskVerb(
          deployment,
        )} task has been running${since}${ecsStatus}. ${STUCK_TASK_HINT}`,
        tone: "note",
      };
    }
    case PUBLISH_TASK_STATE.UNKNOWN:
      return publishTaskUnconfirmedNotice(deployment, now);
    default:
      return null;
  }
}
