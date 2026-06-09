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
