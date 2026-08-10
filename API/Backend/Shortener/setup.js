const router = require("./routes/shortener");

let setup = {
  // Gated off in lean. The discovery seam (API/setups.js) skips the
  // feature-presence hooks when this capability is disabled.
  capability: "shortener",
  //Once the app initializes
  onceInit: (s) => {
    s.app.use(
      s.ROOT_PATH + "/api/shortener",
      s.ensureUser(),
      s.checkHeadersCodeInjection,
      s.setContentType,
      router
    );
  },
  //Once the server starts
  onceStarted: (s) => {},
  //Once all tables sync
  onceSynced: (s) => {},
};

module.exports = setup;
