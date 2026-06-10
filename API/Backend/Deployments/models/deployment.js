/***********************************************************
 * Loading all required dependencies, libraries and packages
 **********************************************************/
const Sequelize = require("sequelize");
const { sequelize } = require("../../../connection");

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
    // provisioning | published | updating | deleting | deleted | failed
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "provisioning",
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

// export Deployments model for use in other files.
module.exports = Deployments;
