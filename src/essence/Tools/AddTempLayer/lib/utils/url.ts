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
 * Stage 1 — detect which supported type a URL is, so we can build the right
 * layerObj. Returns null when it's none of our supported types, in which case
 * the caller tells the user we only support XYZ / WMS / WMTS / GeoJSON.
 *
 * Detection only classifies; it does not check that the URL is well-formed for
 * its type — that's `validateForType` (stage 2). Checked most-specific first.
 */
export function detectLayerType(url: string): TempLayerType | null {
    const u = (url || '').trim().toLowerCase()
    if (u.length === 0) return null

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

/** Result of stage-2 structural validation. `message` is user-facing on failure. */
export interface ValidationResult {
    ok: boolean
    message?: string
}

/** A working example URL per type, shown in the error when validation fails. */
const SAMPLE_URLS = {
    xyz: 'https://host/tiles/{z}/{x}/{y}.png',
    wms: 'https://host/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=name',
    wmts: 'https://host/wmts?SERVICE=WMTS&REQUEST=GetTile&LAYER=name&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
}

/**
 * Stage 2 — once the type is known, check the URL is structurally usable for
 * that type (the URL is never modified; it must already be in a usable form).
 * On failure the message names the problem and gives a working example for that
 * specific type.
 *
 *   xyz / wmts → must be a tile template containing {z}/{x}/{y}
 *   wms        → must carry a LAYERS parameter
 *   geojson    → nothing to check; identity is the response body, not the URL
 *   any tile type → must not contain the {s} subdomain placeholder
 */
export function validateForType(
    type: TempLayerType,
    url: string,
): ValidationResult {
    const u = (url || '').trim().toLowerCase()

    if (type === 'geojson') {
        return { ok: true }
    }

    // {s} is Leaflet's pick-a-subdomain placeholder. We never substitute it,
    // and the deck.gl engine sends it to the network literally — every request
    // fails after an apparently successful add. Make the user pick one.
    if (u.includes('{s}')) {
        return {
            ok: false,
            message: `We can’t add this layer — {s} is a subdomain placeholder we don’t fill in. Replace it with a real subdomain, e.g. https://a.tile.host/{z}/{x}/{y}.png`,
        }
    }

    if (type === 'wms') {
        if (!/[?&]layers=[^&]+/.test(u)) {
            return {
                ok: false,
                message: `We can’t add this layer — the WMS URL needs a LAYERS parameter. Example: ${SAMPLE_URLS.wms}`,
            }
        }
        return { ok: true }
    }

    // xyz / wmts — both render through the template-tile path, so the URL must
    // already contain the {z}/{x}/{y} placeholders the engine fills per tile.
    if (!(u.includes('{z}') && u.includes('{x}') && u.includes('{y}'))) {
        const kind = type === 'wmts' ? 'WMTS' : 'XYZ'
        return {
            ok: false,
            message: `We can’t add this layer — the ${kind} URL needs a {z}/{x}/{y} template. Example: ${SAMPLE_URLS[type]}`,
        }
    }
    return { ok: true }
}
