/***********************************************************
 * Loading all required dependencies, libraries and packages
 **********************************************************/
const Sequelize = require("sequelize");
const { sequelize } = require("../../../connection");

// Canonical deployment lifecycle statuses (the `status` column). Server-side
// code (routes, publish task) must use these constants; the Configure UI keeps
// its display literals.
const STATUS = Object.freeze({
  PROVISIONING: "provisioning",
  PUBLISHED: "published",
  UPDATING: "updating",
  DELETING: "deleting",
  DELETED: "deleted",
  FAILED: "failed",
});

// One row per published dashboard (a standalone, statically-hosted copy of a
// mission). Identity lives here; live stack status comes from CloudFormation
// DescribeStacks at read time, not from this row.
// Note: this feature is named "Deployments" to avoid colliding with the
// modern-ui "Dashboard*" (panel layout) symbols.
var Deployments = sequelize.define(
  "deployments",
  {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    mission: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    created_by: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    // One of STATUS (provisioning | published | updating | deleting |
    // deleted | failed)
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: STATUS.PROVISIONING,
    },
    stack_arn: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    stack_name: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    // Cached at publish time for convenience; the live status is always
    // re-read from DescribeStacks.
    cloudfront_url: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    settings: {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {},
    },
    last_error: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
  }
);

Deployments.STATUS = STATUS;

// Statuses under which a publish task may be running for the row.
const IN_FLIGHT_STATUSES = Object.freeze([STATUS.PROVISIONING, STATUS.UPDATING]);
Deployments.IN_FLIGHT_STATUSES = IN_FLIGHT_STATUSES;

// Records the ECS task ARN of the row's publish task under
// `settings.publish_task_arn`, so a read can ask ECS whether the task is
// still alive. Both the route that starts the task and the task itself call
// this. `settings` is a plain JSON column (last writer wins), so the write
// spreads the latest read; it is conditional on the row still being in
// flight, so a Delete that landed in between never regains a task ARN on
// its `deleting` row. The write is silent so `updatedAt` stays the moment
// the row was claimed for this run, which is what the reads measure the
// task's age from. Resolves the number of rows written (0 or 1).
Deployments.recordPublishTaskArn = async function (deploymentId, taskArn) {
  const latest = await Deployments.findByPk(deploymentId);
  if (latest == null) return 0;
  const [written] = await Deployments.update(
    { settings: { ...(latest.settings || {}), publish_task_arn: taskArn } },
    {
      where: {
        id: deploymentId,
        status: { [Sequelize.Op.in]: IN_FLIGHT_STATUSES },
      },
      silent: true,
    }
  );
  return written;
};

// Marks the row `failed` because ECS reported the publish task recorded on
// it as stopped or missing. The write is pinned to the row still being in
// flight and still carrying that very ARN (a JSON path on `settings`), so
// it can neither overwrite a terminal status the task wrote in the meantime
// nor land on a row an Update has since re-claimed for a new task.
// Resolves the number of rows written (0 or 1).
Deployments.markPublishTaskExited = async function (
  deploymentId,
  taskArn,
  lastError
) {
  const [flipped] = await Deployments.update(
    { status: STATUS.FAILED, last_error: lastError },
    {
      where: {
        id: deploymentId,
        status: { [Sequelize.Op.in]: IN_FLIGHT_STATUSES },
        "settings.publish_task_arn": taskArn,
      },
    }
  );
  return flipped;
};

// export Deployments model for use in other files.
module.exports = Deployments;
