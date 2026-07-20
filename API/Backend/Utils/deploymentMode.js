/**
 * deploymentMode.js
 * Resolves the MMGIS deployment mode (MMGIS_DEPLOYMENT_MODE) once at load.
 *  - "full" (default): the complete MMGIS application as shipped today.
 *  - "lean": a gated-down deployment shape.
 * Any other value is a configuration error and throws at startup.
 */

const VALID_MODES = ["full", "lean"];

const mode = process.env.MMGIS_DEPLOYMENT_MODE || "full";

if (!VALID_MODES.includes(mode)) {
  throw new Error(
    `Invalid MMGIS_DEPLOYMENT_MODE: '${mode}'. Expected one of: ${VALID_MODES.join(
      ", "
    )}. Unset it or set MMGIS_DEPLOYMENT_MODE=full for the default full deployment.`
  );
}

function isLean() {
  return mode === "lean";
}

function isFull() {
  return mode === "full";
}

module.exports = { MODE: mode, isLean, isFull };
