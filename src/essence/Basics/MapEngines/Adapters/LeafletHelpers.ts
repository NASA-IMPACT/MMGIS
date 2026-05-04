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

const CIRCLE_APPROX_STEPS = 32
const EARTH_RADIUS_M = 6378137

/**
 * Convert a finalised L.Draw layer into a GeoJSON Feature in [lng, lat] order.
 *
 * Polygon and Rectangle: layer.toGeoJSON() already produces a Feature; return it.
 * Circle: leaflet-draw produces an L.Circle (no native GeoJSON polygon); we
 * approximate it with a {@link CIRCLE_APPROX_STEPS}-vertex polygon ring around
 * the centre at the configured radius using a great-circle destination formula.
 */
export function leafletDrawnLayerToFeature(
    shape: 'polygon' | 'rectangle' | 'circle',
    layer: any
): GeoJSON.Feature | null {
    if (!layer) return null

    if (shape === 'circle') {
        const center = layer.getLatLng?.()
        const radius = layer.getRadius?.()
        if (!center || typeof radius !== 'number') return null
        const ring = approximateCircleRing(center.lat, center.lng, radius)
        return {
            type: 'Feature',
            properties: { source: 'draw', shape: 'circle', radius },
            geometry: { type: 'Polygon', coordinates: [ring] },
        }
    }

    if (typeof layer.toGeoJSON === 'function') {
        const f = layer.toGeoJSON() as GeoJSON.Feature
        if (!f) return null
        return {
            ...f,
            properties: { ...(f.properties ?? {}), source: 'draw', shape },
        }
    }
    return null
}

/**
 * Pull the in-progress vertex list out of a leaflet-draw `draw:drawvertex` event.
 * The event's `layers` is an L.LayerGroup of L.Marker per vertex.
 */
export function extractDrawVertices(e: any): { lat: number; lng: number }[] {
    const out: { lat: number; lng: number }[] = []
    const lg = e?.layers
    if (lg && typeof lg.eachLayer === 'function') {
        lg.eachLayer((m: any) => {
            const ll = m?.getLatLng?.()
            if (ll) out.push({ lat: ll.lat, lng: ll.lng })
        })
    }
    return out
}

function approximateCircleRing(
    centerLat: number,
    centerLng: number,
    radiusMeters: number
): number[][] {
    const RAD = Math.PI / 180
    const DEG = 180 / Math.PI
    const angularDist = radiusMeters / EARTH_RADIUS_M
    const φ1 = centerLat * RAD
    const λ1 = centerLng * RAD
    const ring: number[][] = []
    for (let i = 0; i <= CIRCLE_APPROX_STEPS; i++) {
        const θ = (i / CIRCLE_APPROX_STEPS) * 2 * Math.PI
        const φ2 = Math.asin(
            Math.sin(φ1) * Math.cos(angularDist) +
                Math.cos(φ1) * Math.sin(angularDist) * Math.cos(θ)
        )
        const λ2 =
            λ1 +
            Math.atan2(
                Math.sin(θ) * Math.sin(angularDist) * Math.cos(φ1),
                Math.cos(angularDist) - Math.sin(φ1) * Math.sin(φ2)
            )
        ring.push([λ2 * DEG, φ2 * DEG])
    }
    return ring
}
