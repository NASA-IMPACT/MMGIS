/**
 * deploymentMode.js
 * Resolves the MMGIS deployment mode (MMGIS_DEPLOYMENT_MODE) once at load.
 *  - "full" (default): the complete MMGIS application as shipped today.
 *  - "lean": a gated-down deployment shape.
 * Any other value is a configuration error and throws at startup.
 *
 * This module is the one env read and exposes only the resolved MODE string.
 * It deliberately exports no isFull()/isLean() predicates: what each mode
 * actually turns on or off is the job of capabilities.js, which reads MODE here
 * and is the single place that interprets it. Ask `enabled("<capability>")`
 * instead of comparing MODE.
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

module.exports = { MODE: mode };
