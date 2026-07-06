// Test stub for the build-generated `src/pre/tools.js`.
//
// `src/pre/tools.js` is written at server start by API/updateTools.js from the
// active mission's tool configuration; it is gitignored and does not exist in a
// fresh checkout or in CI. Unit specs that transitively import it (e.g. the
// PanelManager specs, which pull in Map_.js) only need the module to resolve —
// they exercise panel/layout logic, not the real tool registry. The Vitest
// config aliases `pre/tools` to this stub so the unit suite stays hermetic.
export const Kinds = {}
export const toolConfigs = {}
export const toolModules = {}
export const testModules = {}
