// Pure helpers for AddTempLayer — no MMGIS imports.

export type TempLayerType = 'xyz' | 'wms' | 'wmts' | 'geojson'

/** What the modal collects from the user. */
export interface AddTempLayerInput {
    url: string
    displayName?: string
    type?: TempLayerType
}

/** True if the string is a well-formed http(s) URL. */
export function validateUrl(url: string): boolean {
    const u = (url || '').trim()
    if (u.length === 0) return false
    try {
        const parsed = new URL(u)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

/**
 * Best-effort detect the layer type from a URL. Returns null if unrecognised.
 * Checked most-specific first: templated XYZ, then OGC services, then GeoJSON.
 */
export function detectLayerType(url: string): TempLayerType | null {
    const u = (url || '').trim().toLowerCase()
    if (u.length === 0) return null

    // Templated raster tiles: must contain {z}/{x}/{y}
    if (u.includes('{z}') && u.includes('{x}') && u.includes('{y}')) return 'xyz'

    // OGC services, detected by query params or path
    if (u.includes('service=wmts') || u.includes('request=gettile') || /\bwmts\b/.test(u)) {
        return 'wmts'
    }
    if (u.includes('service=wms') || u.includes('request=getmap')) {
        return 'wms'
    }

    // GeoJSON by extension or output format (.json is a weaker fallback)
    if (
        /\.geojson(\?|$)/.test(u) ||
        u.includes('f=geojson') ||
        u.includes('outputformat=geojson') ||
        /\.json(\?|$)/.test(u)
    ) {
        return 'geojson'
    }

    return null
}

// Monotonic suffix so two adds in the same millisecond still get unique names.
let _tempLayerCounter = 0

/** Unique, colon-free layer name. addLayer rejects duplicates; colons break keying. */
export function uniqueLayerName(): string {
    return `temp-layer-${Date.now()}-${_tempLayerCounter++}`
}

/**
 * Build an MMGIS layerObj for the generic layers:addLayer channel.
 * In-memory only (not persisted), so it shows in the Layers panel but is lost on reload.
 * Returns null if the URL is invalid or the type can't be determined.
 *
 * Type → MMGIS mapping:
 *   geojson → { type: 'vector' }
 *   wms     → { type: 'tile', tileformat: 'wms' }
 *   wmts/xyz → { type: 'tile', tileformat: 'wmts' }  (tms:false; standard z/x/y)
 */
export function buildLayerObj(input: AddTempLayerInput): { name: string } & Record<string, unknown> | null {
    const url = (input.url || '').trim()
    if (!validateUrl(url)) return null

    const type = input.type || detectLayerType(url)
    if (!type) return null

    const base = {
        name: uniqueLayerName(),
        display_name: (input.displayName || '').trim() || 'Imported layer',
        // visibility:true so the layer renders as soon as it's added.
        visibility: true,
        initialOpacity: 1,
    }

    if (type === 'geojson') {
        return { ...base, type: 'vector', url }
    }

    // deck.gl's TileLayer has no {s} subdomain concept, so collapse {s} to a
    // concrete subdomain ('a' is valid on OSM/Carto and harmless on Leaflet).
    const tileUrl = url.replace(/\{s\}/g, 'a')
    // MMGIS sets Leaflet tms:true only when tileformat === 'tms'; standard web
    // XYZ needs tms:false, so xyz maps to 'wmts'.
    const tileformat = type === 'wms' ? 'wms' : 'wmts'
    return {
        ...base,
        type: 'tile',
        url: tileUrl,
        tileformat,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
    }
}
