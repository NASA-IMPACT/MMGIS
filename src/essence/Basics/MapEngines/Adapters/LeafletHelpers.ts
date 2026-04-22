/**
 * Pure utility functions used by LeafletAdapter.
 * Nothing here depends on class state — mirrors DeckGLHelpers.ts.
 */

import type { LayerOptions, TileLayerOptions, GeoJSONLayerOptions, MarkerOptions, IconOptions } from '../types/layers'

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
 * Resolve a marker reference (native Leaflet marker object or string id) to
 * its string id. Markers expose their id via a `_mmgisId` property set by
 * the adapter at creation time.
 */
export function resolveLeafletMarkerId(marker: any | string): string {
    return typeof marker === 'string' ? marker : marker._mmgisId
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
 * Construct a native Leaflet marker from a {@link MarkerOptions} spec.
 *
 * Defaults to `L.circleMarker` (the dominant MMGIS pattern used by
 * MeasureTool, DrawTool, Coordinates, etc.) when no `icon.url` is provided.
 * Falls back to `L.marker` + `L.icon` when an image icon URL is given.
 *
 * @throws {Error} If `options.position` is missing.
 */
export function buildLeafletMarker(id: string, options: MarkerOptions): any {
    if (!options.position) {
        throw new Error('buildLeafletMarker: options.position is required')
    }

    const pos = _normalizePosition(options.position)

    let marker: any

    if (options.icon?.url) {
        const leafletIcon = _buildLeafletIcon(options.icon)
        const markerOptions: Record<string, any> = {
            icon: leafletIcon,
            draggable: options.draggable ?? false,
            interactive: options.interactive ?? true,
            ...(options.zIndexOffset !== undefined ? { zIndexOffset: options.zIndexOffset } : {}),
        }
        marker = L.marker([pos.lat, pos.lng], markerOptions)
    } else {
        const circleOptions: Record<string, any> = {
            interactive: options.interactive ?? true,
            draggable: options.draggable ?? false,
            ...(options.zIndexOffset !== undefined ? { zIndexOffset: options.zIndexOffset } : {}),
        }
        marker = L.circleMarker([pos.lat, pos.lng], circleOptions)
    }

    marker._mmgisId = id
    return marker
}

// ─── Private helpers ──────────────────────────────────────────────────────────

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
 *
 * When no `pointToLayer` is supplied, Point features are rendered as
 * `L.circleMarker` using the `style` options (radius, color, weight, fillColor,
 * fillOpacity). This avoids Leaflet's default `L.marker` fallback — which loads
 * the default marker PNG + shadow — for callers that just want styled dots.
 */
function _buildGeoJSONLayer(id: string, options: GeoJSONLayerOptions): any {
    if (!options.geojson) {
        throw new Error('buildLeafletLayer (vector): options.geojson is required')
    }

    const style = (options.style as Record<string, any>) || {}
    const defaultPointToLayer = (_feature: any, latlng: any) =>
        L.circleMarker(latlng, {
            radius: style.radius ?? 5,
            color: style.color ?? '#3388ff',
            weight: style.weight ?? 2,
            opacity: style.opacity ?? 1,
            fillColor: style.fillColor ?? style.color ?? '#3388ff',
            fillOpacity: style.fillOpacity ?? 0.6,
            interactive: options.interactive ?? true,
        })

    const leafletOptions: Record<string, any> = {
        ...(options.style !== undefined ? { style: options.style } : {}),
        ...(options.onEachFeature ? { onEachFeature: options.onEachFeature } : {}),
        pointToLayer: options.pointToLayer ?? defaultPointToLayer,
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.nativeOptions ?? {}),
    }

    const layer = L.geoJSON(options.geojson, leafletOptions)
    layer._mmgisId = id
    return layer
}

/**
 * Build an L.Icon from {@link IconOptions}.
 */
function _buildLeafletIcon(icon: IconOptions): any {
    const iconOptions: Record<string, any> = {
        iconUrl: icon.url,
    }
    if (icon.size) iconOptions.iconSize = icon.size
    if (icon.anchor) iconOptions.iconAnchor = icon.anchor
    if (icon.className) iconOptions.className = icon.className
    return L.icon(iconOptions)
}

/**
 * Normalize a LatLngLike value to a { lat, lng } object.
 */
function _normalizePosition(position: any): { lat: number; lng: number } {
    if (Array.isArray(position)) {
        return { lat: position[0], lng: position[1] }
    }
    return position
}
