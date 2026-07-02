/**
 * assert-gated-tables.js
 *
 * A feature gated OFF in the current mode still keeps its DB tables: models
 * register and sync() runs unconditionally on boot, only route mounts are gated
 * (ADR D2). This pins that — dropping a model, or gating its registration, fails
 * CI in the leg where the feature is off.
 *
 * Boots the backend setups (registering models), runs sync(), and exits non-zero
 * if any gated-feature table is missing.
 *
 * Must run AFTER scripts/init-db.js: sync() creates PostGIS geometry columns, so
 * the postgis extension must exist first.
 */

require("dotenv").config({ path: __dirname + "/../../.env" });

const { MODE } = require("../../API/Backend/Utils/deploymentMode");
const setups = require("../../API/setups");
const { sequelize } = require("../../API/connection");

// Hand-written: tables behind features gated off in one mode or the other; they
// must exist in BOTH. Accept either spelling where Sequelize may pluralize.
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
        // Loading the setups requires each feature's models, registering them.
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
