/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 **********************************************************/
const {
  UNUSABLE_STACK_STATUSES,
  stackUnusableMessage,
  republishGuidance,
  CONVERGE_DEADLINE_MS,
} = require("../../../scripts/lib/aws-provision");

// How long a `provisioning`/`updating` row is read as a task that is still
// running. The publish task touches its row between steps, so the row's age
// measures how long the task has been silent rather than how long it has been
// working — the window only has to outlast the longest single step, the stack
// convergence CONVERGE_DEADLINE_MS bounds, and doubling that leaves room for a
// heartbeat delayed behind it. Past the window, a row still claiming an
// operation is one nobody is coming back to.
const LIVE_TASK_WINDOW_MS = 2 * CONVERGE_DEADLINE_MS;

// Whether an update may start on a deployment, given a row already merged with
// its live stack status (withLiveStatus in routes/deployments.js) and `STATUS`,
// the deployment model's status map. Returns null when the update may go
// ahead, or { message } naming why it may not. `now` is the clock the row's
// age is measured against.
//
// A stack only a delete can move on from refuses whatever status the row
// carries, `published` and `failed` included: an update of such a row would
// bake and build for minutes only to be rejected by CloudFormation, so the
// endpoint hands over the way out instead.
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
function updateRefusalFor(row, STATUS, now = Date.now()) {
  if (row.status === STATUS.DELETED)
    return { message: "Deployment was deleted; publish it again" };
  const wait = `Deployment is ${row.status}; wait for it to finish`;
  if (row.status === STATUS.DELETING) return { message: wait };
  // A stack no update will ever be accepted onto, whether it is resting there
  // or on its way to a status just like it. No status the row carries makes
  // that stack publishable and no amount of waiting moves it, so the way out
  // is the answer for a settled row as much as a busy-looking one.
  if (UNUSABLE_STACK_STATUSES.indexOf(row.stack_status) !== -1)
    return { message: stackUnusableMessage(row.stack_name, row.stack_status) };
  if (row.status !== STATUS.PROVISIONING && row.status !== STATUS.UPDATING)
    return null;
  // The stack could not be read, so nothing here knows what it is doing; say
  // that, rather than dress a failed read up as an operation in flight.
  if (row.stack_status_error != null)
    return {
      message: `Could not read the deployment's stack: ${row.stack_status_error}`,
    };
  if (row.stack_status != null && row.stack_status.endsWith("_IN_PROGRESS"))
    return { message: wait };
  // Nothing in flight, but a task that touched the row recently enough is
  // still working for it: it may be baking or building, which reaches
  // CloudFormation only at the end. A timestamp that will not parse says
  // nothing about how long ago that was, so it earns the same answer as a
  // fresh one rather than opening the row to a second task.
  const updatedAt = new Date(row.updatedAt).getTime();
  if (Number.isNaN(updatedAt) || now - updatedAt < LIVE_TASK_WINDOW_MS)
    return { message: wait };
  // A row claiming an operation with no stack behind it. With a stack ARN
  // recorded, the stack it owned is gone: nothing for an update to converge,
  // and nothing left to wait for. With none, the task died before CreateStack
  // ever ran, and an update creates the stack (stackAction in
  // scripts/lib/publish-flow.js).
  if (row.stack_status == null && row.stack_arn != null)
    return {
      message: `Deployment is ${row.status} but has no stack; ${republishGuidance()}`,
    };
  return null;
}

module.exports = { updateRefusalFor };
