// Vitest setup for MMGIS unit tests (jsdom environment).
//
// jsdom already provides `window`, `document`, and the standard browser
// element types, which is enough for most of the browser-coupled modules these
// specs import. The remaining gap is Leaflet: some modules read `window.L` at
// import time (e.g. Layers_/LayerConstructors.js extends `L.Tooltip` at module
// load). jsdom doesn't bundle Leaflet, so stub the minimal surface touched
// during import. Specs that need real Leaflet behavior install their own
// `global.L` mock at runtime (see LeafletAdapter.spec.js).
if (typeof window !== "undefined") {
    window.L = window.L || {};
    if (!window.L.Tooltip) {
        window.L.Tooltip = { prototype: {}, include() {} };
    }
    window.L.DomUtil = window.L.DomUtil || { setPosition() {} };
}
