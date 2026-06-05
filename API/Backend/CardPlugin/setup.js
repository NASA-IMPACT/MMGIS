const { createUploadRouter } = require('../Upload/uploadRouter');
const { IMAGE_MIME_TO_EXT } = require('../Upload/validate');

let setup = {
    // Once the app initializes
    onceInit: (s) => {
        // Image upload is a Configure-page (admin) action, so it uses the same
        // authorization posture as the Config write routes (see
        // API/Backend/Config/setup.js): ensureAdmin requires an authenticated
        // admin/lead session (permission "111"/"110"). It does NOT auto-pass
        // under AUTH=off — a session without an admin permission is rejected.
        s.app.use(
            s.ROOT_PATH + '/api/cardplugin',
            s.ensureAdmin(),
            s.checkHeadersCodeInjection,
            s.setContentType,
            createUploadRouter({
                subdir: 'CardPlugin',
                allowedMimeToExt: IMAGE_MIME_TO_EXT,
            })
        );
    },
    // Once the server starts
    onceStarted: (s) => {},
    // Once all tables sync
    onceSynced: (s) => {},
};

module.exports = setup;
