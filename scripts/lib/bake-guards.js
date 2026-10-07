/**
 * bake-guards.js
 * Pure config transforms applied when baking a mission configuration into
 * a static (backend-less) dashboard bundle.
 *
 * Lean gates by default: time-windowed layers whose tiles are served by the
 * admin backend can't resolve in a published dashboard, so when no
 * resolvable (externally-served) time-enabled layer remains, the baked
 * config disables the time UI rather than shipping a scrubber that goes
 * nowhere. Time scrubbing on externally-served time layers still works.
 */

const fs = require("fs");
const path = require("path");

// A URL is resolvable from a static dashboard only when it's absolute
// (http://, https:// or protocol-relative //) — i.e. served by something
// other than the (absent) MMGIS backend.
function isExternallyServedUrl(url) {
  return typeof url === "string" && /^(https?:)?\/\//i.test(url.trim());
}

// Walks the mission layer tree (layers nest through `sublayers`) and calls
// fn(layer) on every node.
function forEachLayer(layers, fn) {
  (layers || []).forEach((layer) => {
    if (layer == null) return;
    fn(layer);
    if (Array.isArray(layer.sublayers)) forEachLayer(layer.sublayers, fn);
  });
}

// True when at least one time-enabled layer references an external URL and
// therefore still resolves in a backend-less dashboard.
function hasResolvableTimeLayer(config) {
  let found = false;
  forEachLayer(config && config.layers, (layer) => {
    if (
      layer.time != null &&
      layer.time.enabled === true &&
      isExternallyServedUrl(layer.url)
    )
      found = true;
  });
  return found;
}

// Disables config.time.enabled in place when no resolvable time-enabled
// layer remains. Returns the (mutated) config for chaining.
function applyTimeBakeGuard(config) {
  if (
    config != null &&
    config.time != null &&
    config.time.enabled === true &&
    !hasResolvableTimeLayer(config)
  )
    config.time.enabled = false;
  return config;
}

// The modern layout lazy-loads the configured theme's stylesheet
// (msv.theme, default 'default') from the build at runtime. A dashboard
// published without it would silently render on unthemed fallbacks, so
// refuse to publish a build that lacks build/dist/<theme>.css.
function assertThemeCssPresent(config, buildDir) {
  const theme = (config && config.msv && config.msv.theme) || "default";
  const cssPath = path.join(buildDir, "dist", `${theme}.css`);
  if (!fs.existsSync(cssPath))
    throw new Error(
      `Theme '${theme}' stylesheet not found at ${cssPath}; run 'npm run build:themes' before 'npm run build'`
    );
  return config;
}

module.exports = {
  isExternallyServedUrl,
  forEachLayer,
  hasResolvableTimeLayer,
  applyTimeBakeGuard,
  assertThemeCssPresent,
};
