const router = require("./routes/datasets");
const { isFull } = require("../Utils/deploymentMode");
let setup = {
  //Once the app initializes
  onceInit: (s) => {
    if (isFull()) {
      s.app.use(
        s.ROOT_PATH + "/api/datasets",
        s.ensureAdmin(),
        s.checkHeadersCodeInjection,
        s.setContentType,
        router
      );
    }
  },
  //Once the server starts
  onceStarted: (s) => {},
  //Once all tables sync
  onceSynced: (s) => {},
};

module.exports = setup;
