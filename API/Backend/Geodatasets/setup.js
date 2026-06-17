const router = require("./routes/geodatasets");

const geodatasets = require("./models/geodatasets");

let setup = {
  // Gated off in lean (route mounts). onceSynced still runs unconditionally at
  // the seam, so the geodatasets table is created in both modes.
  capability: "geodatasets",
  //Once the app initializes
  onceInit: (s) => {
    s.app.use(
      s.ROOT_PATH + "/api/geodatasets",
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
    if (typeof geodatasets.up === "function") {
      geodatasets.up();
    }
  },
};

module.exports = setup;
