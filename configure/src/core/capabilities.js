/**
 * capabilities.js
 * The single place the Configure SPA asks "is this surface enabled?".
 * Today that's just the deployment-mode predicate; the planned
 * post-merge capability table (feature -> mode map) lands here so
 * consumers never compare mode strings themselves.
 */
export const isLeanMode = () =>
  window.mmgisglobal != null && window.mmgisglobal.DEPLOYMENT_MODE === "lean";
