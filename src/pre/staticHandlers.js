// Handlers for static (backend-less) builds: when mmgisglobal.SERVER is not
// 'node', calls.api() dispatches here instead of $.ajax-ing a backend.
// Every named call in src/pre/calls.js' registry must have an entry.
// Dispositions follow docs/adr/deployment/lean/api.md (Frontend dispatcher):
//   Bake    - answer frozen into the bundle at publish (STATIC_MISSION_CONFIG)
//   Compute - answer computed client-side
//   Drop    - graceful error/no-op (write paths, auth, dropped modules)
// Reroutes happen at direct-$.ajax call sites (PR 9), never in this table.

// Lazy require: webpack resolves the STATIC_MISSION_CONFIG alias at bundle
// time, but deferring to first use lets Node-side transforms (unit tests)
// load this module without resolving the alias.
let staticConfig
const getStaticConfig = () => {
    if (staticConfig === undefined) {
        const mod = require('STATIC_MISSION_CONFIG')
        staticConfig = (mod && mod.default) || mod || null
    }
    return staticConfig
}

// Baked answers are keyed by call name in the published staticConfig
const bake = (call) =>
    function (data, success, error) {
        const config = getStaticConfig()
        const baked = config != null ? config[call] : null
        if (baked != null) {
            if (typeof success === 'function') success(baked)
        } else {
            console.warn(
                `Static build: No baked response for '${call}'. Was the mission config published?`
            )
            if (typeof error === 'function') error()
        }
    }

const drop = () =>
    function (data, success, error) {
        if (typeof error === 'function') error()
    }

const STATIC_HANDLERS = {
    // Bake — answered from the published mission config
    get: bake('get'),
    get_generaloptions: bake('get_generaloptions'),
    missions: bake('missions'),
    // Compute — client-side proj4->WKT conversion lands with PR 9;
    // graceful no-op until then
    proj42wkt: drop(),
    // Drop — auth has no backend in a static dashboard
    login: drop(),
    signup: drop(),
    logout: drop(),
    // Drop — GDAL raster queries need a backend; call sites fall back
    // (Identifier uses legend-RGB, elevation readouts hide)
    getbands: drop(),
    getprofile: drop(),
    // Reroute (PR 9) — only ever issued via direct $.ajax in Map_.js;
    // a dispatcher-routed call drops defensively
    getminmax: drop(),
    // Drop — SPICE compute endpoints
    ll2aerll: drop(),
    chronice: drop(),
    // Drop — Draw/Files write paths don't ship in dashboards
    draw_add: drop(),
    draw_edit: drop(),
    draw_remove: drop(),
    draw_undo: drop(),
    draw_merge: drop(),
    draw_split: drop(),
    draw_aggregations: drop(),
    files_getfiles: drop(),
    files_getfile: drop(),
    files_make: drop(),
    files_remove: drop(),
    files_restore: drop(),
    files_change: drop(),
    files_modifykeyword: drop(),
    files_compile: drop(),
    files_publish: drop(),
    files_gethistory: drop(),
    // Drop — modules not deployed alongside dashboards
    shortener_shorten: drop(),
    shortener_expand: drop(),
    clear_test: drop(),
    tactical_targets: drop(),
    datasets_get: drop(),
    geodatasets_get: drop(),
    geodatasets_intersect: drop(),
    geodatasets_aggregations: drop(),
    geodatasets_search: drop(),
    spatial_published: drop(),
    // Drop — time-slider histogram is disabled in lean (PR 9)
    query_tileset_times: drop(),
}

export default STATIC_HANDLERS
