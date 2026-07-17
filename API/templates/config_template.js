// The new-mission starter template is generated from mission-profiles/minimal.json
// by scripts/generate-mission-config.js (see #157). Editing the default a new
// mission starts with is a profile edit + regenerate, never a hand-edit here.
// add() (configs.js) deep-clones this before merging, so the require cache is
// never mutated.
//
// The committed JSON keeps {{PLACEHOLDER}} tokens (so no secret is ever baked
// into the artifact); they resolve here, once, at require time — the template's
// consumption point. An unset env var resolves to "" (falsy), which downstream
// consumers treat the same as a user leaving the field blank (e.g.
// DeckGLAdapter only forwards basemap.accessToken when truthy).

// Deep-walk `value`, replacing each {{KEY}} declared in `replacements` inside
// strings. Unknown tokens are left verbatim. Returns a new structure — the
// required JSON module is never mutated.
function resolvePlaceholders(value, replacements) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (token, key) =>
      Object.prototype.hasOwnProperty.call(replacements, key)
        ? replacements[key]
        : token
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePlaceholders(v, replacements));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = resolvePlaceholders(value[key], replacements);
    }
    return out;
  }
  return value;
}

module.exports = resolvePlaceholders(require("./config_template.json"), {
  MAPBOX_TOKEN: process.env.MAPBOX_TOKEN || "",
});
