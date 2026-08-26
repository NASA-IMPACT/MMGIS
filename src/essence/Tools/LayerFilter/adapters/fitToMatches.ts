// Move the map to whatever the filter just matched.
//
// Filtering narrows the layers list but says nothing about where the map is
// looking, so selecting an activation on the other side of the world left the
// user staring at correctly-loaded tiles that were off-screen. This resolves a
// destination for the current match and asks core to go there.
//
// Resolution order, most specific first:
//   1. an authored `view` on the selected entry's pairing for a matched layer
//      (SCHEMA.md §5 documents `view` on a layer pairing)
//   2. the union of the matched layers' own extents
//   3. the selected entry's geometry
//
// Fails soft throughout: a core without the handlers, a layer with no extent,
// or an unusable geometry leaves the map where it is rather than throwing.

import {
    mmgisFitBounds,
    mmgisGetLayerBounds,
    mmgisRequest,
    type LayerBounds,
} from '../../_shared/adapters/mmgisAPI'

/** An authored camera position: `center` is [lat, lng], matching map:setView. */
export interface AuthoredView {
    center: [number, number]
    zoom?: number
}

/** What fitToMatches did, so callers (and tests) can assert on the branch taken. */
export type FitOutcome = 'view' | 'layers' | 'entry' | 'none'

/** Fit padding in screen pixels — keeps the extent off the panel edges. */
const FIT_PADDING = 40
/** Caps a zero-area extent, which would otherwise resolve to maximum zoom. */
const FIT_MAX_ZOOM = 12

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * An authored `view` off a pairing's attributes, or null when absent or
 * malformed. `center` is accepted as [lat, lng]; anything else is ignored
 * rather than half-applied.
 */
export function readAuthoredView(edge: unknown): AuthoredView | null {
    if (edge == null || typeof edge !== 'object') return null
    const view = (edge as Record<string, unknown>).view
    if (view == null || typeof view !== 'object') return null
    const { center, zoom } = view as Record<string, unknown>
    if (!Array.isArray(center) || center.length < 2) return null
    const [lat, lng] = center
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null
    return {
        center: [lat, lng],
        ...(isFiniteNumber(zoom) ? { zoom } : {}),
    }
}

/** Grows `into` to also contain `next`. Both are [[s, w], [n, e]]. */
export function unionBounds(
    into: LayerBounds | null,
    next: LayerBounds | null,
): LayerBounds | null {
    if (next == null) return into
    if (into == null) return next
    return [
        [Math.min(into[0][0], next[0][0]), Math.min(into[0][1], next[0][1])],
        [Math.max(into[1][0], next[1][0]), Math.max(into[1][1], next[1][1])],
    ]
}

/**
 * The extent of any GeoJSON geometry, as [[south, west], [north, east]].
 *
 * Walks the coordinate nesting rather than switching on `type`, so it handles
 * Point through MultiPolygon and GeometryCollection alike. Null when no finite
 * [lng, lat] pair is reachable.
 */
export function boundsFromGeometry(geometry: unknown): LayerBounds | null {
    if (geometry == null || typeof geometry !== 'object') return null

    let minLat = Infinity
    let minLng = Infinity
    let maxLat = -Infinity
    let maxLng = -Infinity
    let found = false

    const visit = (node: unknown): void => {
        if (!Array.isArray(node)) return
        // A coordinate is [lng, lat, ...]; anything else is a nesting level.
        if (isFiniteNumber(node[0]) && isFiniteNumber(node[1])) {
            const [lng, lat] = node as number[]
            minLat = Math.min(minLat, lat)
            maxLat = Math.max(maxLat, lat)
            minLng = Math.min(minLng, lng)
            maxLng = Math.max(maxLng, lng)
            found = true
            return
        }
        for (const child of node) visit(child)
    }

    const g = geometry as Record<string, unknown>
    if (Array.isArray(g.geometries)) {
        for (const child of g.geometries) {
            const childBounds = boundsFromGeometry(child)
            if (childBounds == null) continue
            found = true
            minLat = Math.min(minLat, childBounds[0][0])
            minLng = Math.min(minLng, childBounds[0][1])
            maxLat = Math.max(maxLat, childBounds[1][0])
            maxLng = Math.max(maxLng, childBounds[1][1])
        }
    } else {
        visit(g.coordinates)
    }

    if (!found) return null
    return [
        [minLat, minLng],
        [maxLat, maxLng],
    ]
}

export interface FitToMatchesArgs {
    /** Layer UUIDs the filter matched. */
    matchedLayerUUIDs: string[]
    /** Pairing attributes for a matched layer, keyed by layer UUID. */
    edgesByLayerUUID: Record<string, unknown>
    /** Geometry of the selected entry, when one is selected. */
    entryGeometry?: unknown
}

/**
 * Sends the map to the current match. Returns which branch was used, or
 * 'none' when nothing could be resolved (in which case the map is untouched).
 */
export async function fitToMatches({
    matchedLayerUUIDs,
    edgesByLayerUUID,
    entryGeometry,
}: FitToMatchesArgs): Promise<FitOutcome> {
    // 1. An authored view wins — it is a deliberate framing choice, and the
    //    only signal that can express a zoom the extent alone would not imply.
    for (const uuid of matchedLayerUUIDs) {
        const view = readAuthoredView(edgesByLayerUUID[uuid])
        if (view == null) continue
        const applied = await mmgisRequest<boolean>('map:setView', {
            center: view.center,
            zoom: view.zoom,
        })
        if (applied === true) return 'view'
        break
    }

    // 2. Otherwise frame everything that matched. Layers with no extent
    //    contribute nothing rather than collapsing the union.
    if (matchedLayerUUIDs.length > 0) {
        const resolved = await Promise.all(
            matchedLayerUUIDs.map((uuid) => mmgisGetLayerBounds(uuid)),
        )
        const union = resolved.reduce<LayerBounds | null>(
            (acc, bounds) => unionBounds(acc, bounds),
            null,
        )
        if (union != null) {
            const fitted = await mmgisFitBounds(union, {
                padding: FIT_PADDING,
                maxZoom: FIT_MAX_ZOOM,
            })
            if (fitted) return 'layers'
        }
    }

    // 3. Nothing had an extent — fall back to where the event happened, which
    //    is still more useful than leaving the map on the default view.
    const entryBounds = boundsFromGeometry(entryGeometry)
    if (entryBounds != null) {
        const fitted = await mmgisFitBounds(entryBounds, {
            padding: FIT_PADDING,
            maxZoom: FIT_MAX_ZOOM,
        })
        if (fitted) return 'entry'
    }

    return 'none'
}
