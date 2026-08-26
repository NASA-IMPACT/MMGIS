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

// jsdom ships no ResizeObserver, so a module that watches an element for late
// reflow (MapPopup_ watches its card) takes a branch no spec could otherwise
// reach. Stand in for it with the surface those modules use, and keep the live
// observers on the constructor so a spec can deliver a resize to whatever is
// being watched — jsdom lays nothing out, so no real one would ever fire.
if (typeof window !== "undefined" && !window.ResizeObserver) {
    class ResizeObserverStub {
        constructor(callback) {
            this.callback = callback;
            this.observed = new Set();
            ResizeObserverStub.instances.add(this);
        }
        observe(target) {
            this.observed.add(target);
        }
        unobserve(target) {
            this.observed.delete(target);
        }
        disconnect() {
            this.observed.clear();
            ResizeObserverStub.instances.delete(this);
        }
    }
    ResizeObserverStub.instances = new Set();
    window.ResizeObserver = ResizeObserverStub;
}
