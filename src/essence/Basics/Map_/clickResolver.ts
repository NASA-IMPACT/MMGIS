import type { FeaturePickResult } from '../MapEngines/types/events'
import type { LatLng, LatLngLike } from '../MapEngines/types/geometry'
import type { PointValue } from '../Layers_/layerValueAt'

// Local rather than DeckGLHelpers' resolveLatLng, which would pull deck.gl in.
const toLatLng = (v: LatLngLike): LatLng =>
    Array.isArray(v) ? { lat: v[0], lng: v[1] } : v

export interface RasterCandidate {
    id: string
    valueAt: (lng: number, lat: number) => Promise<PointValue | null>
}

// Synchronous when there is nothing to ask, so a vector-only click is
// reported exactly when it was before; null when a newer click superseded it.
export type ClickOutcome = FeaturePickResult | Promise<FeaturePickResult | null>

export function createClickResolver() {
    let latest = 0
    return function resolveClick(
        pick: FeaturePickResult,
        candidates: RasterCandidate[]
    ): ClickOutcome {
        const token = ++latest
        if (candidates.length === 0 || pick.latlng == null) return pick
        const latlng = toLatLng(pick.latlng)
        return (async () => {
            for (const candidate of candidates) {
                const answer = await candidate.valueAt(latlng.lng, latlng.lat)
                if (token !== latest) return null
                if (answer != null && answer.value != null) {
                    return rasterPick(pick, candidate.id, answer)
                }
            }
            return pick
        })()
    }
}

function rasterPick(
    pick: FeaturePickResult,
    layerId: string,
    answer: PointValue
): FeaturePickResult {
    const { lat, lng } = toLatLng(pick.latlng!)
    const properties: Record<string, unknown> = {
        value: answer.value,
        location: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    }
    if (answer.asOf !== undefined) properties.asOf = answer.asOf
    if (answer.band !== undefined) properties.band = answer.band
    if (answer.item !== undefined) properties.item = answer.item
    return {
        feature: {
            type: 'Feature',
            properties,
            geometry: { type: 'Point', coordinates: [lng, lat] },
        },
        layerId,
        latlng: pick.latlng,
        pixel: pick.pixel,
    }
}
