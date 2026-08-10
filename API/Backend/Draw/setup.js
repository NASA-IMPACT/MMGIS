const routeFiles = require("./routes/files");
const routerFiles = routeFiles.router;
const routerDraw = require("./routes/draw").router;
const routerAggregations = require("./routes/aggregations");
const ufiles = require("./models/userfiles");
const file_histories = require("./models/filehistories");

let setup = {
  // Gated off in lean (route mounts only). Draw's models register at
  // require-time and sync unconditionally, so its tables (user_files /
  // user_features / file_histories) exist in lean too — unused there, by design
  // (ADR D2: keep, env-gated).
  capability: "draw",
  //Once the app initializes
  onceInit: (s) => {
    s.app.use(
      s.ROOT_PATH + "/api/files",
      s.ensureUser(),
      s.checkHeadersCodeInjection,
      s.setContentType,
      s.stopGuests,
      routerFiles
    );

    s.app.use(
      s.ROOT_PATH + "/api/draw",
      s.ensureUser(),
      s.checkHeadersCodeInjection,
      s.setContentType,
      s.stopGuests,
      routerDraw
    );

    s.app.use(
      s.ROOT_PATH + "/api/draw",
      s.ensureUser(),
      s.checkHeadersCodeInjection,
      s.setContentType,
      s.stopGuests,
      routerAggregations
    );
  },
  //Once the server starts
  onceStarted: (s) => {},
  //Once all tables sync
  onceSynced: (s) => {
    if (typeof file_histories.up === "function") {
      file_histories.up();
    }
    if (typeof ufiles.up === "function") {
      ufiles.up();
    }
    routeFiles.makeMasterFiles([
      "roi",
      "campaign",
      "campsite",
      "trail",
      "signpost",
      "all",
    ]);
  },
};

module.exports = setup;
