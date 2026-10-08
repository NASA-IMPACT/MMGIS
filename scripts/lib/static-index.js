/**
 * static-index.js
 * Turns the image's prebuilt bundle (build/, compiled once at image build)
 * into a static dashboard, without running webpack in the publish task.
 *
 * The bundle carries no per-mission data. What a dashboard needs per mission
 * is written into a staged copy of build/index.html:
 *   - the `#{KEY}` Pug placeholders (which Express would render per request
 *     in server mode) become the static globals, and
 *   - the empty `<script id="mmgis-static-config" type="application/json">`
 *     block from public/index.html is filled with SERVER: "static" plus the
 *     answers src/pre/staticHandlers.js serves in place of the backend.
 * The inline script in public/index.html reads that block into
 * mmgisglobal.STATIC_CONFIG and takes mmgisglobal.SERVER from it.
 *
 * Staging copies build/ so the image's own build/ is never mutated and a
 * re-run starts from the same bytes.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const STATIC_CONFIG_ID = "mmgis-static-config";
// The anchor as it appears in the built index.html. The production
// minifier keeps attribute quotes and order, and leaves the body of a
// non-JavaScript <script> untouched.
const STATIC_CONFIG_BLOCK = new RegExp(
  `(<script id="${STATIC_CONFIG_ID}"[^>]*>)([\\s\\S]*?)(</script>)`,
  "g"
);

// Copies buildDir into a fresh temp dir and returns the staged directory.
// buildDir itself is only read.
function stageBuild(buildDir, stagingRoot) {
  const indexPath = path.join(buildDir, "index.html");
  if (!fs.existsSync(indexPath))
    throw new Error(
      `No prebuilt bundle at ${buildDir} (missing index.html); the image build should have produced it`
    );
  const root =
    stagingRoot || fs.mkdtempSync(path.join(os.tmpdir(), "mmgis-publish-"));
  const stagedDir = path.join(root, "build");
  fs.cpSync(buildDir, stagedDir, { recursive: true });
  return stagedDir;
}

// Number of static-config anchors in the html.
function countStaticConfigAnchors(html) {
  return html.split(`id="${STATIC_CONFIG_ID}"`).length - 1;
}

// JSON for the inside of a <script> element. Every "<" becomes <, so
// no value (an option string containing "</script>", say) can end the
// element early; JSON.parse reads < back as "<".
function serializeStaticConfig(config) {
  return JSON.stringify(config).replace(/</g, "\\u003c");
}

// Fills the static-config block with `config` plus SERVER: "static". Throws
// unless the html has exactly one anchor: zero means the template lost it
// (the dashboard would boot as a server build and call /api), two means the
// target is ambiguous.
function injectStaticConfig(html, config) {
  const anchors = countStaticConfigAnchors(html);
  if (anchors !== 1)
    throw new Error(
      `Expected exactly one id="${STATIC_CONFIG_ID}" block in index.html, found ${anchors}`
    );
  const body = serializeStaticConfig({ ...(config || {}), SERVER: "static" });
  let replaced = 0;
  const out = html.replace(STATIC_CONFIG_BLOCK, (m, open, _old, close) => {
    replaced += 1;
    return `${open}${body}${close}`;
  });
  if (replaced !== 1)
    throw new Error(
      `The id="${STATIC_CONFIG_ID}" anchor is not a <script id="${STATIC_CONFIG_ID}" ...>...</script> block`
    );
  return out;
}

// Reads the static-config block back (tests and dry runs).
function readStaticConfig(html) {
  STATIC_CONFIG_BLOCK.lastIndex = 0;
  const match = STATIC_CONFIG_BLOCK.exec(html);
  STATIC_CONFIG_BLOCK.lastIndex = 0;
  if (match == null) return null;
  return JSON.parse(match[2] || "{}");
}

// Placeholders that sit in HTML (title text / meta attribute); every other
// placeholder sits in a double-quoted JS string in the inline script.
const HTML_CONTEXT_KEYS = new Set([
  "LINK_PREVIEW_TITLE",
  "LINK_PREVIEW_DESCRIPTION",
]);

// Escape for a double-quoted JS string literal. JSON.stringify handles
// backslashes, quotes and control chars; the extra escaping of every "<"
// stops a value containing "</script>" from closing the inline <script>.
const escapeForJsString = (value) =>
  JSON.stringify(String(value))
    .slice(1, -1)
    .replace(/</g, "\\u003c");

const escapeForHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Replaces the `#{KEY}` Pug placeholders with `globals`, escaped per context
// so values like a mission named `Jezero "Delta"` can't break the inline
// <script> or the <title>. Unknown placeholders become empty strings, the
// same as unset env vars under Pug.
function interpolateStaticGlobals(html, globals) {
  return html.replace(/#\{([A-Za-z_]+)\}/g, (m, key) => {
    const value = globals[key];
    if (value == null) return "";
    return HTML_CONTEXT_KEYS.has(key)
      ? escapeForHtml(value)
      : escapeForJsString(value);
  });
}

// The whole index.html rewrite: placeholders first, then the static config,
// so baked option values are never scanned for placeholders.
function renderStaticIndex(html, { globals, config }) {
  return injectStaticConfig(
    interpolateStaticGlobals(html, globals || {}),
    config
  );
}

module.exports = {
  STATIC_CONFIG_ID,
  stageBuild,
  countStaticConfigAnchors,
  serializeStaticConfig,
  injectStaticConfig,
  readStaticConfig,
  escapeForJsString,
  escapeForHtml,
  interpolateStaticGlobals,
  renderStaticIndex,
};
