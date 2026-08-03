// Single source of truth for backend / base URLs used across the Configure app.
//
// In development the MMGIS server runs on `window.mmgisglobal.PORT` and serves the
// dashboard SPA on `PORT + 1`; in production, requests are relative to `ROOT_PATH`.
// The port is injected per-deployment at render time (see API/Backend/Config/setup.js),
// so deriving URLs from it here keeps the CMS working on any port instead of a
// hardcoded one. Every site that needs a base URL must go through these helpers —
// the old hardcoded `localhost:8888` was duplicated in six places and only failed
// on non-default ports because of that duplication.

const isDev = () =>
  Boolean(window.mmgisglobal && window.mmgisglobal.NODE_ENV === "development");

const withTrailingSlash = (s) =>
  s.length > 0 && !s.endsWith("/") ? s + "/" : s;

// Base URL for backend / API requests, always trailing-slashed.
// dev -> "http://localhost:<PORT>/"   ·   prod -> "<ROOT_PATH>/"
export function getApiBase() {
  const base = isDev()
    ? `http://localhost:${window.mmgisglobal.PORT}/`
    : (window.mmgisglobal && window.mmgisglobal.ROOT_PATH) || "";
  return withTrailingSlash(base);
}

// Base URL of the main dashboard site (served on PORT + 1 in dev), NOT
// trailing-slashed. Pass the production value (e.g. publicUrlMainSite) as the
// fallback used outside development.
export function getMainSiteBase(prodFallback = "") {
  return isDev()
    ? `http://localhost:${parseInt(window.mmgisglobal.PORT, 10) + 1}`
    : prodFallback;
}
