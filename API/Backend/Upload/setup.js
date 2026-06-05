// API/Backend/Upload is a shared library module — it exposes createUploadRouter
// (./uploadRouter.js) and validation helpers (./validate.js) for plugins to
// mount under their own namespaces, and registers no routes of its own.
//
// The core setup scanner (API/setups.js) requires a setup.js from every
// API/Backend/* directory, so this provides the standard no-op lifecycle hooks.
let setup = {
    onceInit: (s) => {},
    onceStarted: (s) => {},
    onceSynced: (s) => {},
};

module.exports = setup;
