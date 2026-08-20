import type { LayerConfig, LayerBounds, MapBounds } from '../adapters/mmgisAPI'
import type { Layer } from './types'

// View-aware filtering for the export legend only — getVisibleLayersWithLegends
// stays "every toggled-on layer" for the LayerManager panel. Every check here
// excludes a layer only on positive evidence; a missing or null signal always
// means keep, since an export with an extra row is far less wrong than one
// that silently drops a layer core couldn't answer for.
//
// A layer's config `boundingBox`/`layers:getBounds` footprint is authoritative
// for a vector layer — it comes from the actual rendered geometry. For every
// other type (tile, cog, image, ...) it's advisory metadata a mission author
// wrote down, not a render clip: a raster commonly paints well outside its
// declared bbox (live-observed: a COG painting ~40% of its footprint span
// past the declared edge). Excluding a raster needs the viewport to miss even
// a generously padded version of that box — see padFootprint. The zoom gate
// is vector-only too, mirroring core's enforceVisibilityCutoffs (Layers_.js),
// which never zoom-gates non-vector layers because they overzoom and keep
// painting past their configured maxZoom.

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

// Expands a raster-ish layer's declared footprint before it's tested against
// the viewport: each axis grows by 100% of that axis's own span on each
// side (so a box triples in size along that axis), with a 0.5° minimum pad
// per side for a footprint whose span is zero or tiny. Longitude is padded
// on the raw (unnormalized) west/east pair — a padded span >= 360 falls out
// to boundsIntersect's existing whole-world guard, and latitude is clamped
// to ±90 inside boundsIntersect itself.
const padFootprint = (bounds: LayerBounds): LayerBounds => {
    const [[south, west], [north, east]] = bounds
    const latPad = Math.max(north - south, 0.5)
    const lngPad = Math.max(east - west, 0.5)
    return [
        [south - latPad, west - lngPad],
        [north + latPad, east + lngPad],
    ]
}

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
    // than normalizing it into a deceptively narrow segment pair. A layer's
    // bounds can just as well span the whole world (e.g. [[-90,-180],[90,180]]
    // for a global basemap); normalizing that the same way collapses it to
    // the single point at the antimeridian, so it needs the same guard.
    const viewportLngSpan = viewport.northEast.lng - viewport.southWest.lng
    if (viewportLngSpan >= 360) return true

    const layerLngSpan = layerEast - layerWest
    if (layerLngSpan >= 360) return true

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
 *
 * This is the range calculation only — enforceVisibilityCutoffs applies it
 * exclusively to `type === 'vector'` layers, so the caller (filterLayersForExportView)
 * gates on that before calling this, rather than this function checking it.
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
 * (opacity 0), a vector layer zoomed out of its configured range, or a layer
 * provably off-screen. Any signal this needs that core couldn't answer — no
 * viewport, no zoom, no bounds for that layer — leaves the corresponding
 * check a no-op rather than excluding the layer.
 *
 * The zoom gate and the strictness of the bounds check both depend on the
 * layer's type: only a vector layer is zoom-gated at all (matching core's
 * enforceVisibilityCutoffs), and only a vector layer's bounds are tested as
 * a hard edge — every other type's declared footprint is advisory, so it's
 * padded generously (padFootprint) before the same intersection test.
 */
export const filterLayersForExportView = (
    layers: Layer[],
    { layerConfigs, viewportBounds, zoom, layerBounds }: ExportViewSignals,
): Layer[] => {
    const dropped: string[] = []

    const kept = layers.filter((layer) => {
        const layerConfig = layerConfigs?.[layer.id]
        const isVector = layerConfig?.type === 'vector'

        if (layer.opacity === 0) {
            dropped.push(`"${layer.title}" (opacity 0)`)
            return false
        }

        if (
            isVector &&
            zoom != null &&
            !isWithinConfiguredZoomRange(layerConfig, zoom)
        ) {
            dropped.push(`"${layer.title}" (outside configured zoom range at zoom ${zoom})`)
            return false
        }

        const bounds = layerBounds?.[layer.id]
        if (viewportBounds != null && bounds != null) {
            const testBounds = isVector ? bounds : padFootprint(bounds)
            if (!boundsIntersect(viewportBounds, testBounds)) {
                dropped.push(
                    `"${layer.title}" (${isVector ? 'bounds' : 'padded footprint'} outside the viewport)`,
                )
                return false
            }
        }

        return true
    })

    // The fail-open contract (getExportLegendModel just renders no band when
    // rows end up empty) otherwise leaves no trace of why — log the one case
    // that actually did the emptying: this filter itself dropped every
    // candidate layer.
    if (layers.length > 0 && kept.length === 0) {
        console.info(
            '[export legend] every layer was filtered out of the export view:',
            dropped,
        )
    }

    return kept
}
