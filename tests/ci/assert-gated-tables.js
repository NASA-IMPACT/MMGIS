/**
 * assert-gated-tables.js
 *
 * Acceptance #4 of the both-modes CI coverage: features that are gated OFF in a
 * given deployment mode must STILL have their database tables created, so a
 * later mode flip needs no data migration. Model registration + sequelize.sync()
 * run unconditionally on boot — only the route MOUNTS are gated — so the tables
 * should exist regardless of mode.
 *
 * This script mirrors what scripts/server.js does at boot WITHOUT starting the
 * HTTP server (and therefore without a webpack build): it loads every backend
 * setup module (each of which requires its Sequelize models, registering them on
 * the shared connection), runs sequelize.sync() to create the tables, then
 * asserts the gated-feature tables are present.
 *
 * ORDERING: sequelize.sync() creates tables with PostGIS geometry columns (e.g.
 * user_features), so the postgis extension must already exist. The CI workflow
 * runs scripts/init-db.js (which enables postgis) BEFORE this script. Do not run
 * it standalone against a bare database or sync() throws
 * `type "geometry" does not exist`.
 *
 * It runs in BOTH legs of the CI matrix. In lean, the gated-OFF features
 * (datasets, geodatasets, draw/user-files, the link shortener) have no mounted
 * routes — this proves their tables exist anyway. In full, the lean-only
 * Deployments feature is the gated-OFF one — its table must exist too. Rather
 * than special-case per mode, we assert the union: every table below must exist
 * in every mode.
 *
 * Exits non-zero (failing the CI leg) if any expected table is missing.
 */

require("dotenv").config({ path: __dirname + "/../../.env" });

const { MODE } = require("../../API/Backend/Utils/deploymentMode");
const setups = require("../../API/setups");
const { sequelize } = require("../../API/connection");

// Hand-written from the deployment feature inventory: the tables behind the
// features that are gated OFF in one mode or the other. They must exist in BOTH
// modes. The shortener model is `url_shortener`; Sequelize pluralizes it to
// `url_shorteners` by default, so accept either spelling.
const REQUIRED_TABLE_GROUPS = [
    ["datasets"], // geodata management (datasets)
    ["geodatasets"], // geodata management (geodatasets)
    ["user_files"], // on-disk mission filesystem / drawing
    ["user_features"], // drawing (vector features)
    ["url_shorteners", "url_shortener"], // link shortener
    ["deployments"], // lean-only dashboard publish flow
];

async function main() {
    await new Promise((resolve) => {
        // Loading the backend setups requires each feature's setup.js, which in
        // turn requires its models — registering them on the shared sequelize.
        setups.getBackendSetups(() => resolve());
    });

    await sequelize.authenticate();
    await sequelize.sync();

    const tables = await sequelize
        .getQueryInterface()
        .showAllTables();
    const present = new Set(tables.map((t) => String(t).toLowerCase()));

    const missing = [];
    for (const group of REQUIRED_TABLE_GROUPS) {
        const found = group.some((name) => present.has(name.toLowerCase()));
        if (!found) missing.push(group.join(" | "));
    }

    if (missing.length > 0) {
        console.error(
            `[assert-gated-tables] MODE=${MODE}: missing expected table(s): ${missing.join(
                ", "
            )}`
        );
        console.error(
            `[assert-gated-tables] tables present: ${[...present]
                .sort()
                .join(", ")}`
        );
        process.exit(1);
    }

    console.log(
        `[assert-gated-tables] MODE=${MODE}: all ${REQUIRED_TABLE_GROUPS.length} gated-feature table groups present.`
    );
    process.exit(0);
}

main().catch((err) => {
    console.error("[assert-gated-tables] Unexpected failure:", err);
    process.exit(1);
});
