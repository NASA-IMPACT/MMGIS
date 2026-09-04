/**
 * rootPath.js
 * The one reading of ROOT_PATH, the path prefix the app is served under.
 *
 * Every consumer joins its own "/…" onto the prefix, so the prefix must not
 * end in one: "/mmgis/" plus "/configure" is "/mmgis//configure", which
 * matches no route and resolves no relative asset. The value is read per call
 * rather than at load so a process that sets ROOT_PATH after requiring this
 * still gets the current prefix.
 *
 * @returns {string} the prefix with any trailing slashes removed, or "" when
 *     the app is served from the origin root
 */
function rootPath() {
  return (process.env.ROOT_PATH || "").replace(/\/+$/, "");
}

module.exports = { rootPath };
