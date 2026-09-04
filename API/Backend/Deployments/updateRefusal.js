/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 **********************************************************/
const {
  UNUSABLE_STACK_STATUSES,
} = require("../../../scripts/lib/aws-provision");

// How long a `provisioning`/`updating` row is read as a task that is still
// running. A publish task bakes, builds, and waits on CloudFormation, so it
// can sit between observable steps for many minutes; past this window a row
// still claiming an operation is one nobody is coming back to.
const LIVE_TASK_WINDOW_MS = 60 * 60 * 1000;

// Whether an update may start on a deployment, given a row already merged with
// its live stack status (withLiveStatus in routes/deployments.js) and `STATUS`,
// the deployment model's status map. Returns null when the update may go
// ahead, or { message } naming why it may not. `now` is the clock the row's
// age is measured against.
//
// For `provisioning` and `updating` the row alone doesn't settle it: a publish
// task killed before its error handler runs leaves the row sitting in one of
// them forever, and nothing else ever moves it. So they are refused while the
// live stack reports an operation in flight, and while the row is young enough
// that a task could still be working for it; an older row resting on a settled
// stack passes.
//
// `deleting` gets no such reprieve: teardown empties the bucket before
// DeleteStack, so the stack reads as settled for most of a delete, and a
// teardown that fails leaves the row deleting behind a stack that never moves.
// A `deleted` row has no stack left to converge at all, so it earns its own
// answer.
function updateRefusalFor(row, STATUS, now = Date.now()) {
  if (row.status === STATUS.DELETED)
    return { message: "Deployment was deleted; publish it again" };
  const wait = `Deployment is ${row.status}; wait for it to finish`;
  if (row.status === STATUS.DELETING) return { message: wait };
  if (row.status !== STATUS.PROVISIONING && row.status !== STATUS.UPDATING)
    return null;
  // The stack could not be read, so nothing here knows what it is doing; say
  // that, rather than dress a failed read up as an operation in flight.
  if (row.stack_status_error != null)
    return {
      message: `Could not read the deployment's stack: ${row.stack_status_error}`,
    };
  if (row.stack_status != null && row.stack_status.endsWith("_IN_PROGRESS")) {
    // An in-flight operation only a delete can move the stack on from: no
    // update will ever be accepted onto it, so waiting is the wrong advice.
    if (UNUSABLE_STACK_STATUSES.indexOf(row.stack_status) !== -1)
      return {
        message:
          `Stack '${row.stack_name}' is in ${row.stack_status} and cannot be ` +
          "used — delete the deployment and publish it again (this mints a new URL)",
      };
    return { message: wait };
  }
  // Nothing in flight, but a task started recently enough is still the row's:
  // it may be baking or building, which reaches CloudFormation only at the end.
  const updatedAt = new Date(row.updatedAt).getTime();
  if (!Number.isNaN(updatedAt) && now - updatedAt < LIVE_TASK_WINDOW_MS)
    return { message: wait };
  // A row claiming an operation with no stack behind it. With a stack ARN
  // recorded, the stack it owned is gone: nothing for an update to converge,
  // and nothing left to wait for. With none, the task died before CreateStack
  // ever ran, and an update creates the stack (stackAction in
  // scripts/lib/publish-flow.js).
  if (row.stack_status == null && row.stack_arn != null)
    return {
      message: `Deployment is ${row.status} but has no stack; delete it and publish again.`,
    };
  return null;
}

module.exports = { updateRefusalFor };
