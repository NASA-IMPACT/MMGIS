/***********************************************************
 * JavaScript syntax format: ES5/ES6 - ECMAScript 2015
 **********************************************************/
const STATUS = require("./models/deployment").STATUS;

// Whether an update may start on a deployment, given a row already merged with
// its live stack status (withLiveStatus in routes/deployments.js). Returns null
// when the update may go ahead, or { message } naming why it may not.
//
// For `provisioning` and `updating` the row alone doesn't settle it: a publish
// task killed before its error handler runs leaves the row sitting in one of
// them forever, and nothing else ever moves it — so they are refused only when
// the live stack backs the row up, by reporting an operation still in flight or
// by not being there at all. A row resting on a settled stack passes.
//
// `deleting` gets no such reprieve: teardown empties the bucket before
// DeleteStack, so the stack reads as settled for most of a delete, and a
// teardown that fails leaves the row deleting behind a stack that never moves.
// A `deleted` row has no stack left to converge at all, so it earns its own
// answer.
function updateRefusalFor(row) {
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
  // No stack behind a row that claims an operation is running: there is
  // nothing for an update to converge, and nothing left to wait for.
  if (row.stack_status == null)
    return {
      message: `Deployment is ${row.status} but has no stack; delete it and publish again.`,
    };
  if (row.stack_status.endsWith("_IN_PROGRESS")) return { message: wait };
  return null;
}

module.exports = { updateRefusalFor };
