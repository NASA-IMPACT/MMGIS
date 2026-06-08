const { createUploadRouter } = require('./uploadRouter');
const { IMAGE_MIME_TO_EXT } = require('./validate');

// Upload is a generic, plugin-agnostic core service. It exposes a single image
// upload endpoint that any caller (plugin or core) reaches over the API — no
// per-plugin backend code lives here. The caller names its target per request
// via the `mission` and `subdir` query params (both validated against path
// traversal); files land under Missions/<mission>/<subdir>/uploads/.
let setup = {
    // Once the app initializes
    onceInit: (s) => {
        // Image upload is a Configure-page (admin) action, so it uses the same
        // authorization posture as the Config write routes (see
        // API/Backend/Config/setup.js): ensureAdmin requires an authenticated
        // admin/lead session (permission "111"/"110"). It does NOT auto-pass
        // under AUTH=off — a session without an admin permission is rejected.
        s.app.use(
            s.ROOT_PATH + '/api/upload',
            s.ensureAdmin(),
            s.checkHeadersCodeInjection,
            s.setContentType,
            createUploadRouter({ allowedMimeToExt: IMAGE_MIME_TO_EXT })
        );
    },
    // Once the server starts
    onceStarted: (s) => {},
    // Once all tables sync
    onceSynced: (s) => {},
};

module.exports = setup;
