const router = require('./routes/upload');

let setup = {
    // Once the app initializes
    onceInit: (s) => {
        // Image upload is a Configure-page (admin) action, so it uses the same
        // authorization posture as the /api/configure routes (see
        // API/Backend/Config/setup.js): ensureAdmin gates it to admin/lead
        // sessions (and passes under AUTH=none), not ensureUser/stopGuests.
        s.app.use(
            s.ROOT_PATH + '/api/cardplugin',
            s.ensureAdmin(),
            s.checkHeadersCodeInjection,
            s.setContentType,
            router
        );
    },
    // Once the server starts
    onceStarted: (s) => {},
    // Once all tables sync
    onceSynced: (s) => {},
};

module.exports = setup;
