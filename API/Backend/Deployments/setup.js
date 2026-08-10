// Requiring the model registers it with Sequelize so the global
// sequelize.sync() on boot creates the `deployments` table in both modes.
// The publish flow is lean-only, so in full the routes below are never mounted
// (capability gated off via the seam) and the table stays passive. Models
// aren't per-mode-gated (ADR D2: keep, env-gated); the unused table is harmless.
require("./models/deployment");

let setup = {
  // The publish flow exists ONLY in lean. The discovery seam mounts the routes
  // below only when this capability is enabled.
  capability: "deployments",
  //Once the app initializes
  onceInit: (s) => {
    const routeDeployments = require("./routes/deployments");
    s.app.use(
      s.ROOT_PATH + "/api/deployments",
      s.ensureAdmin(),
      s.checkHeadersCodeInjection,
      routeDeployments.router
    );
  },
  //Once the server starts
  onceStarted: (s) => {},
  //Once all tables sync
  onceSynced: (s) => {},
};

module.exports = setup;
