const router = require("./routes/configs");
const triggerWebhooks = require("../Webhooks/processes/triggerwebhooks.js");
const configurePackageJson = require("../../../configure/package.json");
const { MODE, isLean } = require("../Utils/deploymentMode");
const { stripTrailingSlashRedirect } = require("../Utils/rootPathRedirect");
const { rootPath } = require("../Utils/rootPath");

let setup = {
  //Once the app initializes
  onceInit: (s) => {
    if (
      !process.env.hasOwnProperty("HIDE_CONFIG") ||
      process.env.HIDE_CONFIG != "true"
    ) {
      s.app.get(
        s.ROOT_PATH + "/configure",
        // The CMS's asset URLs are document-relative off the slash-less
        // address, so the slashed form Express also matches here is sent back
        // to it rather than rendered.
        stripTrailingSlashRedirect(s.ROOT_PATH + "/configure"),
        s.ensureGroup(s.permissions.users),
        s.ensureAdmin(true),
        (req, res) => {
          const user = process.env.AUTH === "csso" ? req.user : req.user || "";
          const permission = req.session.permission || "000";
          res.render("../configure/build/index.pug", {
            user: user,
            permission: permission,
            AUTH: process.env.AUTH,
            NODE_ENV: process.env.NODE_ENV,
            VERSION: configurePackageJson.version,
            PORT: process.env.PORT || "8888",
            ENABLE_CONFIG_WEBSOCKETS: process.env.ENABLE_CONFIG_WEBSOCKETS,
            ENABLE_CONFIG_OVERRIDE: process.env.ENABLE_CONFIG_OVERRIDE,
            ROOT_PATH:
              process.env.NODE_ENV === "development"
                ? ""
                : /*(process.env.EXTERNAL_ROOT_PATH || "") +*/
                  rootPath(),
            WEBSOCKET_ROOT_PATH:
              process.env.NODE_ENV === "development"
                ? ""
                : process.env.WEBSOCKET_ROOT_PATH || "",
            IS_DOCKER: process.env.IS_DOCKER,
            WITH_STAC: isLean() ? "false" : process.env.WITH_STAC,
            WITH_TIPG: isLean() ? "false" : process.env.WITH_TIPG,
            WITH_TITILER: isLean() ? "false" : process.env.WITH_TITILER,
            WITH_TITILER_PGSTAC: isLean()
              ? "false"
              : process.env.WITH_TITILER_PGSTAC,
            DEPLOYMENT_MODE: MODE,
          });
        }
      );
    }

    s.app.use(
      s.ROOT_PATH + "/api/configure",
      s.ensureAdmin(),
      s.checkHeadersCodeInjection,
      s.setContentType,
      router
    );
  },
  //Once the server starts
  onceStarted: (s) => {},
  //Once all tables sync
  onceSynced: (s) => {
    triggerWebhooks("getConfiguration", {});
  },
};

module.exports = setup;
