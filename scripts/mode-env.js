/**
 * mode-env.js
 *
 * Print the sidecar WITH_* env lines implied by the current deployment mode, so
 * the env/bash world (docker-compose, the entrypoint, CI) reads the SAME
 * capabilities.js authority the JS app does instead of hand-maintaining a list.
 *
 * When the `localSidecars` capability is OFF (lean), every bundled sidecar flag
 * is forced off; when it is ON (full), nothing is printed and the existing env
 * (sample.env / the deployment's own values) stands. Usage:
 *
 *   node scripts/mode-env.js >> .env
 *
 * In full this appends nothing (a no-op); in lean it appends the disables.
 *
 * dotenv MUST be loaded before requiring capabilities: deploymentMode.js reads
 * MMGIS_DEPLOYMENT_MODE from process.env at import and does no dotenv of its
 * own, and CI writes the mode into the .env FILE (not the process env). Same
 * dotenv-then-capabilities order as scripts/init-db.js and scripts/server.js.
 */

require("dotenv").config({ path: __dirname + "/../.env" });
const { enabled } = require("../API/Backend/Utils/capabilities");

// The bundled sidecar cluster's on/off env flags (the `localSidecars`
// capability). One list, one place — derived on, not echoed by hand.
const SIDECAR_FLAGS = [
  "WITH_STAC",
  "WITH_TIPG",
  "WITH_TITILER",
  "WITH_TITILER_PGSTAC",
  "WITH_VELOSERVER",
];

if (!enabled("localSidecars")) {
  process.stdout.write(
    SIDECAR_FLAGS.map((flag) => `${flag}=false`).join("\n") + "\n"
  );
}
