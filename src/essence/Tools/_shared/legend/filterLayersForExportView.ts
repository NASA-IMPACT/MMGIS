import type { LayerConfig, LayerBounds, MapBounds } from '../adapters/mmgisAPI'
import type { Layer } from './types'

// View-aware filtering for the export legend only — getVisibleLayersWithLegends
// stays "every toggled-on layer" for the LayerManager panel. Every check here
// excludes a layer only on positive evidence; a missing or null signal always
// means keep, since an export with an extra row is far less wrong than one
// that silently drops a layer core couldn't answer for.

const normalizeLng = (lng: number): number =>
    (((lng + 180) % 360) + 360) % 360 - 180

// Splits a west/east interval into one or two [start, end] segments in
// [-180, 180], so a range that straddles the antimeridian (east < west once
// both are normalized) is represented as the two segments either side of it.
const lngSegments = (west: number, east: number): Array<[number, number]> => {
    const w = normalizeLng(west)
    const e = normalizeLng(east)
    if (e >= w) return [[w, e]]
    return [
        [w, 180],
        [-180, e],
    ]
}

const segmentsOverlap = (a: [number, number], b: [number, number]): boolean =>
    a[0] <= b[1] && b[0] <= a[1]

const clampLat = (lat: number): number => Math.max(-90, Math.min(90, lat))

/**
 * Whether a layer's bounds provably intersect the viewport. Handles a
 * world-wrapped viewport (map:getBounds can report longitudes beyond
 * ±180, e.g. -214..214 after repeated panning) and antimeridian-straddling
 * extents on either side.
 */
export const boundsIntersect = (
    viewport: MapBounds,
    layerBounds: LayerBounds,
): boolean => {
    const viewportLatSouth = clampLat(viewport.southWest.lat)
    const viewportLatNorth = clampLat(viewport.northEast.lat)
    const [[layerSouth, layerWest], [layerNorth, layerEast]] = layerBounds
    const layerLatSouth = clampLat(layerSouth)
    const layerLatNorth = clampLat(layerNorth)

    const latOverlap =
        viewportLatSouth <= layerLatNorth && layerLatSouth <= viewportLatNorth
    if (!latOverlap) return false

    // A viewport spanning 360° or more of longitude has wrapped all the way
    // around — every longitude is visible, so treat it as whole-world rather
    // than normalizing it into a deceptively narrow segment pair.
    const viewportLngSpan = viewport.northEast.lng - viewport.southWest.lng
    if (viewportLngSpan >= 360) return true

    const viewportSegments = lngSegments(
        viewport.southWest.lng,
        viewport.northEast.lng,
    )
    const layerSegments = lngSegments(layerWest, layerEast)

    return viewportSegments.some((vSeg) =>
        layerSegments.some((lSeg) => segmentsOverlap(vSeg, lSeg)),
    )
}

/**
 * Mirrors enforceVisibilityCutoffs's (Layers_.js) notion of zoom visibility:
 * an explicit minZoom/maxZoom pair wins when either key is present at all,
 * otherwise the legacy visibilitycutoff sign convention applies, otherwise
 * there's no restriction. Only the config's own declared maxZoom gates the
 * max side — never an engine-derived value like maxNativeZoom, which lets
 * tile layers overzoom past their configured maxZoom for viewing.
 */
export const isWithinConfiguredZoomRange = (
    layerConfig: LayerConfig | null | undefined,
    zoom: number,
): boolean => {
    if (!layerConfig) return true

    let minZoom: number | null = null
    let maxZoom: number | null = null
    if (
        Object.prototype.hasOwnProperty.call(layerConfig, 'minZoom') ||
        Object.prototype.hasOwnProperty.call(layerConfig, 'maxZoom')
    ) {
        const cfgMinZoom = layerConfig.minZoom as number | null | undefined
        const cfgMaxZoom = layerConfig.maxZoom as number | null | undefined
        minZoom = cfgMinZoom != null ? cfgMinZoom : null
        maxZoom = cfgMaxZoom != null ? cfgMaxZoom : null
    } else if (
        Object.prototype.hasOwnProperty.call(layerConfig, 'visibilitycutoff')
    ) {
        const cutoff = layerConfig.visibilitycutoff as number
        minZoom = cutoff > 0 ? cutoff : null
        maxZoom = cutoff < 0 ? cutoff : null
    }

    minZoom = minZoom != null ? minZoom : 0
    maxZoom = maxZoom != null ? maxZoom : 100

    return zoom >= minZoom && zoom <= maxZoom
}

export type ExportViewSignals = {
    layerConfigs: Record<string, LayerConfig> | null
    viewportBounds: MapBounds | null
    zoom: number | null
    layerBounds: Record<string, LayerBounds | null> | null
}

/**
 * Drops layers the export shouldn't show a legend row for: fully transparent
 * (opacity 0), zoomed out of their configured range, or provably off-screen.
 * Any signal this needs that core couldn't answer — no viewport, no zoom, no
 * bounds for that layer — leaves the corresponding check a no-op rather than
 * excluding the layer.
 */
export const filterLayersForExportView = (
    layers: Layer[],
    { layerConfigs, viewportBounds, zoom, layerBounds }: ExportViewSignals,
): Layer[] =>
    layers.filter((layer) => {
        if (layer.opacity === 0) return false

        if (
            zoom != null &&
            !isWithinConfiguredZoomRange(layerConfigs?.[layer.id], zoom)
        ) {
            return false
        }

        const bounds = layerBounds?.[layer.id]
        if (
            viewportBounds != null &&
            bounds != null &&
            !boundsIntersect(viewportBounds, bounds)
        ) {
            return false
        }

        return true
    })
