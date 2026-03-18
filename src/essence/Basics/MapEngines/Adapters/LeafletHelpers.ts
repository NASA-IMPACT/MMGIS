/**
 * Pure utility functions used by LeafletAdapter.
 * Nothing here depends on class state — mirrors DeckGLHelpers.ts.
 */

import type { LayerOptions, TileLayerOptions, GeoJSONLayerOptions } from '../types/layers'

declare const L: any

/**
 * Resolve a layer reference (native Leaflet layer object or string id) to its
 * string id. Leaflet layers expose their id via a `_mmgisId` property set by
 * the adapter at creation time.
 */
export function resolveLeafletLayerId(layer: any | string): string {
    return typeof layer === 'string' ? layer : layer._mmgisId
}

/**
 * Construct a native Leaflet layer from a {@link LayerOptions} spec.
 * Supports `'tile'` (L.tileLayer) and `'vector'` (L.geoJSON).
 * Use `nativeOptions` on the layer options object for Leaflet-specific props.
 *
 * @throws {Error} If `options.type` is not a supported layer type.
 */
export function buildLeafletLayer(id: string, options: LayerOptions): any {
    switch (options.type) {
        case 'tile':
            return _buildTileLayer(id, options as TileLayerOptions)
        case 'vector':
            return _buildGeoJSONLayer(id, options as GeoJSONLayerOptions)
        default:
            throw new Error(
                `buildLeafletLayer: unsupported layer type "${options.type}". ` +
                `Supported types: 'tile', 'vector'.`
            )
    }
}

/**
 * Build an L.tileLayer from {@link TileLayerOptions}.
 * TMS origin (bottom-left) is the default — matching existing MMGIS tile behaviour.
 * Pass `tms: false` for standard XYZ / WMS slippy tiles.
 */
function _buildTileLayer(id: string, options: TileLayerOptions): any {
    if (!options.url) {
        throw new Error('buildLeafletLayer (tile): options.url is required')
    }

    const leafletOptions: Record<string, any> = {
        tms: options.tms !== undefined ? options.tms : true,
        opacity: options.opacity ?? 1,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
        maxNativeZoom: options.maxNativeZoom,
        subdomains: options.subdomains ?? 'abc',
        attribution: options.attribution ?? '',
        tileSize: options.tileSize ?? 256,
        noWrap: true,
        continuousWorld: true,
        ...(options.nativeOptions ?? {}),
    }

    // Strip undefined values so Leaflet uses its own defaults
    Object.keys(leafletOptions).forEach((k) => {
        if (leafletOptions[k] === undefined) delete leafletOptions[k]
    })

    const layer = L.tileLayer(options.url, leafletOptions)
    layer._mmgisId = id
    return layer
}

/**
 * Build an L.geoJSON layer from {@link GeoJSONLayerOptions}.
 * Callback props (style, onEachFeature, pointToLayer, filter) are forwarded as-is.
 */
function _buildGeoJSONLayer(id: string, options: GeoJSONLayerOptions): any {
    if (!options.geojson) {
        throw new Error('buildLeafletLayer (vector): options.geojson is required')
    }

    const leafletOptions: Record<string, any> = {
        ...(options.style !== undefined ? { style: options.style } : {}),
        ...(options.onEachFeature ? { onEachFeature: options.onEachFeature } : {}),
        ...(options.pointToLayer ? { pointToLayer: options.pointToLayer } : {}),
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.nativeOptions ?? {}),
    }

    const layer = L.geoJSON(options.geojson, leafletOptions)
    layer._mmgisId = id
    return layer
}
