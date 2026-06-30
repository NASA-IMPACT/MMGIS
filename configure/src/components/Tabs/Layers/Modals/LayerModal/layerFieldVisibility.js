// Engine-aware field visibility for the layer config modal.
// - Non-leaflet engines hide engine-unsupported fields (ENGINE_HIDDEN_FIELDS).
// - Leaflet hides deck-only fields (DECK_ONLY_FIELDS), e.g. the client-side
//   COG renderer option, which must be ABSENT (not just disabled) in Leaflet.

// Moved verbatim from LayerModal.js (keep existing entries).
export const ENGINE_HIDDEN_FIELDS = {
    deckgl: {
        _all: new Set([
            "variables.markerIcon.shadowUrl",
            "variables.markerIcon.shadowSize.0",
            "variables.markerIcon.shadowSize.1",
            "variables.markerIcon.shadowAnchor.0",
            "variables.markerIcon.shadowAnchor.1",
        ]),
        vector: new Set([
            "shape",
            "style.shapeIcon",
            "style.shapeProp",
            "style.shapeRotationOffset",
            "style.animation",
        ]),
        GeoJsonLayer: new Set([
            "shape",
            "style.shapeIcon",
            "style.shapeProp",
            "style.shapeRotationOffset",
            "style.animation",
        ]),
        ScatterplotLayer: new Set([
            "shape",
            "style.shapeIcon",
            "style.shapeProp",
            "style.shapeRotationOffset",
            "style.animation",
        ]),
        tile: new Set([]),
        TileLayer: new Set([]),
        BitmapLayer: new Set([]),
        Tile3DLayer: new Set([]),
        PointCloudLayer: new Set([]),
        MVTLayer: new Set([]),
    },
}

// Fields that only make sense for deck.gl missions and must be ABSENT
// (not just disabled) when the mission engine is leaflet.
export const DECK_ONLY_FIELDS = {
    _all: ['cogRendererMode'],
}

function unionForType(map, layerType) {
    if (!map) return new Set()
    return new Set([...(map._all ?? []), ...(map[layerType] ?? [])])
}

export function getHiddenFieldsForEngine(mapEngine, layerType) {
    if (mapEngine === 'leaflet') return unionForType(DECK_ONLY_FIELDS, layerType)
    return unionForType(ENGINE_HIDDEN_FIELDS[mapEngine], layerType)
}

export function stripHiddenFields(config, hidden) {
    if (!hidden || hidden.size === 0 || !config.tabs) return config
    const cloned = JSON.parse(JSON.stringify(config))
    cloned.tabs.forEach((tab) => {
        tab.rows.forEach((row) => {
            row.components = row.components.filter(
                (comp) => !comp.field || !hidden.has(comp.field)
            )
        })
        tab.rows = tab.rows.filter((row) => row.components.length > 0)
    })
    cloned.tabs = cloned.tabs.filter((tab) => tab.rows.length > 0)
    return cloned
}
