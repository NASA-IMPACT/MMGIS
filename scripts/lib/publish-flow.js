/**
 * publish-flow.js
 * The decisions scripts/publish-static.js makes around its AWS work, kept
 * apart from the task entrypoint so each is a plain function of its inputs —
 * no environment, no AWS clients, no database.
 */

const Sequelize = require("sequelize");

const { stackMissingMessage, republishGuidance } = require("./aws-provision");

function statusNotIn(statuses) {
  return { status: { [Sequelize.Op.notIn]: statuses } };
}

// The statuses a Delete owns: it claims the row the moment it starts, and
// anything this task leaves behind on a deleting/deleted row would raise a
// dashboard the operator asked to tear down.
// `STATUS` is the deployment model's status map, passed in so this file needs
// no database connection.
function claimedByDelete(STATUS) {
  return [STATUS.DELETING, STATUS.DELETED];
}

// The `where` fragment that keeps a terminal write on a row this task is still
// responsible for.
function rowStillOurs(STATUS) {
  return statusNotIn(claimedByDelete(STATUS));
}

// The same fragment for the write that marks the row failed, which also leaves
// a `published` row alone: a later task that got the dashboard live owns the
// status, and a straggler's failure must not paint over it.
function rowStillOursForFailure(STATUS) {
  return statusNotIn([...claimedByDelete(STATUS), STATUS.PUBLISHED]);
}

// What to do with the dashboard's stack, given the action the task was started
// with and a DescribeStacks read (`stack`, null when there is none). Returns
// "create", "converge", or { refuse: message } for the one combination that is
// neither.
//
// An existing stack is always converged: this run's template has to reach it,
// and converging is what keeps two simultaneous republishes safe. With no
// stack, a publish creates one. So does an update of a row that never got a
// stack ARN, since there is no live URL for a second stack to displace — but
// an update of a row that HAS one would mint a second URL behind the same row,
// which is not an update.
function stackAction({ action, stack, stackName, stackArn }) {
  if (stack != null) return "converge";
  if (action === "publish" || stackArn == null) return "create";
  const missing = stackMissingMessage(stackName);
  return { refuse: `${missing} — ${republishGuidance()}` };
}

// Throws unless `row` is a deployment this task should still be working for.
// Called before each step that leaves something behind (a stack, a filled
// bucket), so a Delete that lands mid-build stops the task rather than handing
// the operator a dashboard they already tore down.
function assertRowLive(row, STATUS) {
  if (row == null)
    throw new Error("Deployment row is gone; abandoning this publish");
  if (claimedByDelete(STATUS).indexOf(row.status) !== -1)
    throw new Error(`Deployment is ${row.status}; abandoning this publish`);
}

module.exports = {
  rowStillOurs,
  rowStillOursForFailure,
  stackAction,
  assertRowLive,
};
