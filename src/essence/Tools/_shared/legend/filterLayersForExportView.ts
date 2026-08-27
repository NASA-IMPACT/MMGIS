import type { Layer } from './types'

// Which toggled-on layers earn a legend row in an export. The rule is simply
// that a toggled-on layer gets a row — no viewport or zoom test narrows it
// further, because neither can be answered honestly. A layer's configured
// boundingBox is author-written metadata that routinely disagrees with where
// the layer actually paints (live-observed: a bbox describing one granule
// over Nicaragua on a collection mosaic painting over Uruguay), and it is all
// that is on offer even for a vector layer, whose deck.gl path falls back to
// that same configured box when its GeoJSON comes from a URL (Layers_.js).
// Configured zoom ranges drift the same way: core lets a per-feature
// style.minZoom/maxZoom replace the layer-level range, so gating on that
// range can drop a layer that is plainly painted on screen.
//
// The one exclusion is opacity 0. That signal is local and exact, mirrors no
// core logic, and means the layer provably paints nothing — so it gets no row.

export const filterLayersForExportView = (layers: Layer[]): Layer[] => {
    const dropped: string[] = []

    const kept = layers.filter((layer) => {
        if (layer.opacity === 0) {
            dropped.push(`"${layer.title}" (opacity 0)`)
            return false
        }
        return true
    })

    // The fail-open contract (getExportLegendModel just renders no band when
    // rows end up empty) otherwise leaves no trace of why — log the one case
    // that actually did the emptying: this filter itself dropped every
    // candidate layer.
    if (layers.length > 0 && kept.length === 0) {
        console.info(
            '[export legend] every layer was excluded from the legend:',
            dropped,
        )
    }

    return kept
}
