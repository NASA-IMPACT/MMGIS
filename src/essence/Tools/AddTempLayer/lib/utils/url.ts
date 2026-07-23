// Pure URL helpers — no MMGIS imports, no DOM, no network. Inputs in, values out.
import type { TempLayerType } from '../types'

/** True if the string is a well-formed http(s) URL. */
export function validateUrl(url: string): boolean {
    const u = (url || '').trim()
    if (u.length === 0) return false
    // Reject internal whitespace — a single URL has none after trimming, so this
    // catches two URLs pasted into the field at once (which would otherwise be
    // concatenated into one broken request).
    if (/\s/.test(u)) return false
    try {
        const parsed = new URL(u)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

/**
 * Detect which supported type a URL is, so we can build the right layerObj.
 * Returns null when it's none of our supported types, in which case the
 * caller tells the user we only support XYZ / WMS / WMTS / GeoJSON.
 *
 * Detection only classifies — it holds no opinion on whether the URL will
 * actually render. The layer is added optimistically and the map engine
 * reports the real outcome (via the layers:loadStatusChanged bus event).
 * Checked most-specific first.
 */
export function detectLayerType(url: string): TempLayerType | null {
    const u = url.toLowerCase()

    // GeoJSON — by extension or output format (.json is a weaker fallback)
    if (
        /\.geojson(\?|$)/.test(u) ||
        u.includes('f=geojson') ||
        u.includes('outputformat=geojson') ||
        /\.json(\?|$)/.test(u)
    ) {
        return 'geojson'
    }

    // WMTS — OGC KVP markers
    if (u.includes('service=wmts') || u.includes('request=gettile')) {
        return 'wmts'
    }

    // WMS — OGC KVP markers
    if (u.includes('service=wms') || u.includes('request=getmap')) {
        return 'wms'
    }

    // XYZ — a templated raster-tile URL
    if (u.includes('{z}') && u.includes('{x}') && u.includes('{y}')) {
        return 'xyz'
    }

    // None of the supported types.
    return null
}

