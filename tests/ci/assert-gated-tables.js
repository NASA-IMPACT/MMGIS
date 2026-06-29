/**
 * assert-gated-tables.js
 *
 * A feature gated OFF in the current deployment mode must still have its DB
 * tables, so flipping modes later needs no data migration. Model registration +
 * sequelize.sync() run unconditionally on boot (only route mounts are gated), so
 * the tables should exist in either mode.
 *
 * Boots the backend setups (registering the models), runs sync(), and asserts
 * the gated-feature tables are present — exits non-zero if any are missing.
 *
 * Must run AFTER scripts/init-db.js: sync() creates PostGIS geometry columns, so
 * the postgis extension has to exist first or it throws
 * `type "geometry" does not exist`.
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
