/**
 * capabilities.js
 * The single authoritative definition of what each deployment mode includes.
 *
 * `deploymentMode.js` stays the one env read (MMGIS_DEPLOYMENT_MODE -> MODE);
 * this file is the one *meaning* of each mode. Reading the FEATURES map below
 * answers "what does lean turn off (and on)" without grepping call sites.
 *
 * A capability's rule is a predicate over a small context ({ mode }), so a
 * future composite condition (two axes) does not force a rewrite from a flat
 * boolean table. Booleans and mode-lists are accepted as sugar for the common
 * single-axis case; full predicates are used only where they earn their keep.
 *
 * Contract (backend): an unknown capability THROWS — a typo is a deploy error,
 * not a silently-disabled feature. (The frontend twin in
 * configure/src/core/capabilities.js deliberately warns + hides instead, so a
 * render-time gate fails safe rather than white-screening the SPA.)
 *
 * Transitional artifact: enumerating every gated feature by name in the core is
 * the kind of core-knows-every-feature coupling the plugin direction aims to
 * dissolve. The durable half is that a module/tool *declares* the capability it
 * needs and a seam decides; expect a future plugin manifest to subsume this map.
 */

const { MODE } = require("./deploymentMode");

// Sugar coercions:
//  - boolean  -> enabled in every mode (or none)
//  - string[] -> enabled only in the listed modes
//  - function -> predicate over { mode }
const coerce = (rule) => {
  if (typeof rule === "function") return rule;
  if (Array.isArray(rule)) return ({ mode }) => rule.includes(mode);
  if (typeof rule === "boolean") return () => rule;
  throw new Error(`Invalid capability rule: ${JSON.stringify(rule)}`);
};

//                      enabling mode(s)
const FEATURES = {
  // Geodata management — gated off in lean.
  datasets: ["full"],
  geodatasets: ["full"],
  // Collaborative drawing — gated off in lean.
  draw: ["full"],
  // Link shortener — gated off in lean.
  shortener: ["full"],
  // Dashboard publish flow — exists ONLY in lean.
  deployments: ["lean"],
  // On-disk Missions/ filesystem (static mount) plus the server-side raster /
  // SPICE utils endpoints (GDAL + Python shellouts) that read it. Not a
  // sidecar — its own capability.
  localMissions: ["full"],
  // The bundled sidecar cluster: the adjacent-servers proxy mounts, the
  // adjacent-servers spawner, the mmgis-stac database creation, and the
  // derived WITH_* Configure flags. They always move together, so one row.
  localSidecars: ["full"],
  // Image uploads persist to the shared S3 asset bucket instead of local disk.
  // Lean containers are ephemeral and published dashboards are static, so disk
  // isn't durable there; full keeps writing under the on-disk Missions/ tree.
  s3AssetUploads: ["lean"],
};

const RULES = Object.fromEntries(
  Object.entries(FEATURES).map(([name, rule]) => [name, coerce(rule)])
);

/**
 * enabled(capability) -> boolean
 * Throws on an unknown capability so typos fail at boot.
 */
const enabled = (capability) => {
  const rule = RULES[capability];
  if (rule == null) {
    throw new Error(
      `Unknown capability: '${capability}'. Add it to API/Backend/Utils/capabilities.js or fix the typo.`
    );
  }
  return rule({ mode: MODE });
};

module.exports = { enabled };
