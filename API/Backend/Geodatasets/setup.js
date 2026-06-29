const router = require("./routes/geodatasets");

const geodatasets = require("./models/geodatasets");

let setup = {
  // Gated off in lean (route mounts only). The model registers at require-time
  // and syncs unconditionally, so the geodatasets table exists in lean too —
  // unused there, by design (ADR D2: keep, env-gated; don't per-mode-gate model
  // registration).
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
