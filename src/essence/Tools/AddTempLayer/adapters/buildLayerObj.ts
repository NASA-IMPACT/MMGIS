// MMGIS-coupled transform: AddTempLayerInput → an MMGIS layerObj for the
// generic `layers:addLayer` channel. In-memory only (not persisted), so the
// layer shows in the Layers panel but is lost on reload.
import type { AddTempLayerInput } from '../lib/types'
import { validateUrl, detectLayerType } from '../lib/utils/url'

// Monotonic suffix so two adds in the same millisecond still get unique names.
let _tempLayerCounter = 0

/** Unique, colon-free layer name. addLayer rejects duplicates; colons break keying. */
export function uniqueLayerName(): string {
    return `temp-layer-${Date.now()}-${_tempLayerCounter++}`
}

/**
 * Build an MMGIS layerObj. Returns null if the URL is invalid or the type
 * can't be detected.
 *
 * The URL is passed through VERBATIM — we never construct, rewrite, or
 * substitute anything in it. We assume the user pasted a URL already in a
 * supported, ready-to-use form (the modal documents those forms); if it isn't,
 * it simply won't render, which is the user's responsibility, not ours.
 *
 * Type → MMGIS mapping:
 *   geojson    → { type: 'vector', url }
 *   wms        → { type: 'tile', tileformat: 'wms', url } — the engine appends
 *                BBOX/WIDTH/HEIGHT per tile and parses LAYERS/FORMAT from the url.
 *   wmts / xyz → { type: 'tile', tileformat: 'wmts', url } — a {z}/{x}/{y}
 *                template the engine fills per tile; must already be one.
 */
export function buildLayerObj(
    input: AddTempLayerInput,
): ({ name: string } & Record<string, unknown>) | null {
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

    if (type === 'wms') {
        // WMS renders at any zoom (no fixed native tile grid), so no maxNativeZoom.
        return {
            ...base,
            type: 'tile',
            tileformat: 'wms',
            url,
            minZoom: 0,
            maxZoom: 22,
        }
    }

    // wmts / xyz — a {z}/{x}/{y} tile template the engine fills per tile,
    // passed through unchanged.
    return {
        ...base,
        type: 'tile',
        tileformat: 'wmts',
        url,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
    }

}
