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
 * Type → MMGIS mapping:
 *   geojson  → { type: 'vector' }
 *   wms      → { type: 'tile', tileformat: 'wms' }
 *   wmts/xyz → { type: 'tile', tileformat: 'wmts' }  (tms:false; standard z/x/y)
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
