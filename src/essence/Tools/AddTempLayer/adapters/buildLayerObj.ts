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
 * can't be determined.
 *
 * Type → MMGIS mapping (consumed by the merged core WMS support):
 *   geojson → { type: 'vector', url }
 *   wms     → { type: 'tile', tileformat: 'wms', url } — full WMS url passed
 *             through; Leaflet's WMSColorFilter and deck.gl's WMSLayer both
 *             parse LAYERS/FORMAT/… out of it.
 *   wmts    → { type: 'tile', tileformat: 'wmts', url } — KVP rewritten to a
 *             {z}/{y}/{x} template so it renders via the template-tile path.
 *   xyz     → { type: 'tile', tileformat: 'wmts', url } — {z}/{x}/{y} template.
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
        // Pass the full WMS url through unchanged: both engines parse the WMS
        // params (LAYERS, FORMAT, …) out of it. WMS renders at any zoom (no
        // fixed native tile grid), so no maxNativeZoom.
        return {
            ...base,
            type: 'tile',
            tileformat: 'wms',
            url,
            minZoom: 0,
            maxZoom: 22,
        }
    }

    if (type === 'wmts') {
        // Rewrite a WMTS KVP GetTile endpoint into a {z}/{y}/{x} url template so
        // it renders via the standard template-tile path in both engines.
        const templated = buildWmtsTemplate(url)
        if (!templated) return null
        return {
            ...base,
            type: 'tile',
            tileformat: 'wmts',
            url: templated,
            minZoom: 0,
            maxNativeZoom: 18,
            maxZoom: 22,
        }
    }

    // xyz — templated raster tiles. deck.gl's TileLayer has no {s} subdomain
    // concept, so collapse {s} to a concrete subdomain ('a' is valid on
    // OSM/Carto and harmless on Leaflet). tileformat 'wmts' => tms:false.
    return {
        ...base,
        type: 'tile',
        tileformat: 'wmts',
        url: url.replace(/\{s\}/g, 'a'),
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
    }
}

/**
 * Rewrite a WMTS KVP GetTile url into a {z}/{y}/{x} template. Returns null when
 * no LAYER param is present (WMTS can't request a tile without one). Best-effort:
 * assumes a zoom-indexed TileMatrix (web-mercator GoogleMapsCompatible), which
 * covers the common Earth case; named matrix sets won't map cleanly.
 */
function buildWmtsTemplate(rawUrl: string): string | null {
    const qIdx = rawUrl.indexOf('?')
    const baseUrl = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx)
    const search = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1)
    const params = new URLSearchParams(search)
    const get = (k: string): string | null => {
        for (const [key, val] of params) {
            if (key.toLowerCase() === k) return val
        }
        return null
    }

    const layer = get('layer')
    if (!layer) return null

    // Build the literal template by hand — URLSearchParams would percent-encode
    // the {z}/{y}/{x} braces and break the placeholders.
    const qs = [
        'SERVICE=WMTS',
        'REQUEST=GetTile',
        `VERSION=${get('version') || '1.0.0'}`,
        `LAYER=${encodeURIComponent(layer)}`,
        `STYLE=${encodeURIComponent(get('style') || 'default')}`,
        `FORMAT=${encodeURIComponent(get('format') || 'image/png')}`,
        `TILEMATRIXSET=${encodeURIComponent(get('tilematrixset') || 'GoogleMapsCompatible')}`,
        'TILEMATRIX={z}',
        'TILEROW={y}',
        'TILECOL={x}',
    ].join('&')
    return `${baseUrl}?${qs}`
}
