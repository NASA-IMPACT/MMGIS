/**
 * rootPathRedirect.js
 * The entry redirects that put a page's address bar in the shape its
 * document-relative asset URLs need.
 *
 * A browser resolves a relative URL against everything up to the last "/" of
 * the current address, so the trailing slash decides which folder the page's
 * assets are fetched from. The app's index page is served under a folder
 * (`<ROOT_PATH>/`) and needs the slash; the Configure CMS is served at
 * `<ROOT_PATH>/configure` and needs it gone.
 */

// Both redirects are 302 rather than 301: the Location carries the visitor's
// own query string, while browsers and edge caches key a permanent redirect
// by path alone and would replay one visitor's deep link to the next.
// Cache-Control: no-store says the same thing to any cache that ignores the
// status code.
function redirect(req, res, location) {
  const q = req.originalUrl.indexOf("?");
  const query = q === -1 ? "" : req.originalUrl.slice(q);
  res.set("Cache-Control", "no-store");
  res.redirect(302, `${location}${query}`);
}

/**
 * Middleware that sends the slash-less entry URL of a `rootPath`-prefixed app
 * to its trailing-slash form. An empty `rootPath` (the app is served from the
 * origin root, where there is no slash to add) yields a pass-through.
 *
 * @param {string} rootPath - the path prefix the app is served under, with no
 *     trailing slash
 * @returns {Function} an Express middleware
 */
function rootPathRedirect(rootPath) {
  if (!rootPath) return (req, res, next) => next();
  return (req, res, next) => {
    if (req.path !== rootPath) return next();
    redirect(req, res, `${rootPath}/`);
  };
}

/**
 * Middleware that sends the trailing-slash form of `path` to `path` itself.
 * Express matches a route both with and without its trailing slash, so mount
 * this ahead of the route's own handlers to keep the slashed form from being
 * rendered.
 *
 * @param {string} path - the slash-less path the route is mounted at
 * @returns {Function} an Express middleware
 */
function stripTrailingSlashRedirect(path) {
  return (req, res, next) => {
    if (!req.path.endsWith("/")) return next();
    redirect(req, res, path);
  };
}

module.exports = { rootPathRedirect, stripTrailingSlashRedirect };
