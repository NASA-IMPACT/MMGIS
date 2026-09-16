/**
 * demo-mission-converge.js
 * Boot-time convergence of the demo mission to its committed blueprint
 * (`mission-profiles/generated/full-demo-mission.json`).
 *
 * Opt-in via OVERWRITE_DEMO_MISSION=true. When enabled, the newest saved
 * version of the mission named in the blueprint is compared against the
 * blueprint itself: a missing mission is created at version 0, an identical
 * one is left alone, and a differing one gets exactly one new version
 * appended so prior versions stay in history. No other mission is touched.
 *
 * This runs during boot, so it never throws: every failure is swallowed
 * after a single structured error log line.
 */

const fs = require("fs");
const path = require("path");

// "MMGIS demo-mission convergence lock" — fixed advisory-lock key so only one
// booting server copy performs the demo-mission convergence check.
const DEMO_MISSION_LOCK_KEY = 24920260716;

const MAPBOX_TOKEN_PLACEHOLDER = "{{MAPBOX_TOKEN}}";

const DEFAULT_BLUEPRINT_PATH = path.join(
  __dirname,
  "..",
  "mission-profiles",
  "generated",
  "full-demo-mission.json"
);

// Recursive structural equality. Object key order does not matter, array
// order does. JSON.stringify comparison is not usable here: the saved config
// round-trips through Postgres JSON, which does not preserve key order.
// (API/utils.js's isEqual is also unusable: its deep mode throws on nested
// null values, and its isSimple mode is the key-order-sensitive
// JSON.stringify comparison.)
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  // typeof null === "object", and a === b above already covered null === null
  if (a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// Reads the committed blueprint, substitutes the Mapbox token and parses it.
// Throws if the file is unreadable, the JSON is bad, or the placeholder is
// present with no token to put in its place.
function resolveBlueprint(deps = {}) {
  const env = deps.env || process.env;
  const readFile = deps.readFile || fs.readFileSync;
  const blueprintPath = deps.blueprintPath || DEFAULT_BLUEPRINT_PATH;

  const raw = String(readFile(blueprintPath, "utf8"));

  let substituted = raw;
  if (raw.indexOf(MAPBOX_TOKEN_PLACEHOLDER) !== -1) {
    const token = env.MAPBOX_TOKEN;
    if (token == null || token === "") {
      // Substituting an empty token would both break basemaps and make the
      // blueprint differ from the saved config on every boot, appending a
      // new version each time. Skipping is the safe outcome.
      throw new Error(
        `MAPBOX_TOKEN is unset but ${blueprintPath} contains ${MAPBOX_TOKEN_PLACEHOLDER}`
      );
    }
    // split/join, not String.replace: a token containing "$&"-style patterns
    // would be mangled by replacement-string expansion.
    substituted = raw.split(MAPBOX_TOKEN_PLACEHOLDER).join(token);
  }

  return JSON.parse(substituted);
}

// The advisory-lock query returns a single boolean column. Depending on the
// Sequelize version and options it can arrive as a row object, a nested array
// or a raw value, so unwrap defensively.
function isLockAcquired(result) {
  let row = result;
  while (Array.isArray(row)) row = row[0];
  if (row == null) return false;

  let value = row;
  if (typeof row === "object") {
    value = row.locked !== undefined ? row.locked : Object.values(row)[0];
  }
  return value === true || value === "t" || value === "true";
}

function defaultLoadModel() {
  // Required lazily: pulling in the model pulls in API/connection.js, which
  // opens a database connection on require. Nothing should happen when the
  // feature is off.
  return {
    Config: require("../API/Backend/Config/models/config"),
    sequelize: require("../API/connection").sequelize,
  };
}

// Converges the demo mission to the committed blueprint. Resolves to an
// outcome object and never rejects.
async function convergeDemoMission(deps = {}) {
  const env = deps.env || process.env;
  if (env.OVERWRITE_DEMO_MISSION !== "true") return { outcome: "disabled" };

  const logger = deps.logger || require("../API/logger");

  try {
    const blueprint = resolveBlueprint({
      env,
      readFile: deps.readFile,
      blueprintPath: deps.blueprintPath,
    });

    const mission = blueprint && blueprint.msv && blueprint.msv.mission;
    if (!mission) {
      throw new Error(
        "The demo-mission blueprint has no msv.mission to converge"
      );
    }

    const loadModel = deps.loadModel || defaultLoadModel;
    const { Config, sequelize } = loadModel();

    // init-db runs before server.js calls sequelize.sync(), so the table may
    // not exist yet (same reason seedSuperadmin() calls User.sync()).
    await Config.sync();

    return await sequelize.transaction(async (t) => {
      // Advisory locks are connection-scoped, and with Sequelize's pool a
      // separate lock and unlock query can land on different pooled
      // connections — silently unlocking nothing. A transaction-scoped lock
      // pins one connection and releases on commit or rollback: no unlock
      // call to mispair, no stale lock if the process dies mid-check.
      const lockResult = await sequelize.query(
        `SELECT pg_try_advisory_xact_lock(${DEMO_MISSION_LOCK_KEY}) AS locked`,
        { transaction: t, plain: true }
      );

      if (!isLockAcquired(lockResult)) {
        logger(
          "info",
          "Another instance holds the demo-mission convergence lock; skipping.",
          "demo_convergence"
        );
        return { outcome: "lock_held" };
      }

      const latest = await Config.findOne({
        where: { mission },
        order: [["version", "DESC"]],
        transaction: t,
      });

      if (latest == null) {
        await Config.create(
          { mission, config: blueprint, version: 0 },
          { transaction: t }
        );
        logger(
          "info",
          `Created the "${mission}" mission from its committed blueprint at version 0.`,
          "demo_convergence"
        );
        return { outcome: "created" };
      }

      if (deepEqual(blueprint, latest.config)) {
        logger(
          "info",
          `The "${mission}" mission already matches its committed blueprint; nothing to do.`,
          "demo_convergence"
        );
        return { outcome: "unchanged" };
      }

      const version = latest.version + 1;
      await Config.create(
        { mission, config: blueprint, version },
        { transaction: t }
      );
      logger(
        "info",
        `Converged the "${mission}" mission to its committed blueprint as version ${version}.`,
        "demo_convergence"
      );
      return { outcome: "appended" };
    });
  } catch (err) {
    // Exactly one line per failure: the "demo_convergence_error" caller is the
    // machine-recognizable handle a future alarm can grep the JSON logs for.
    logger(
      "error",
      "Demo-mission convergence failed and was skipped: " + err.message,
      "demo_convergence_error",
      null,
      err
    );
    return { outcome: "error", error: err };
  }
}

module.exports = {
  DEMO_MISSION_LOCK_KEY,
  deepEqual,
  resolveBlueprint,
  convergeDemoMission,
};
