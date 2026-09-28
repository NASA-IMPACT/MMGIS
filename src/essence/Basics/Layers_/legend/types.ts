/** What a layer's legend draws as. `none` means there is nothing to draw. */
export type LegendType = 'gradient' | 'categorical' | 'text' | 'none'

export type LegendSwatch = { color: string; label: string }

/**
 * A layer's legend, as core resolves it — the answer `layers:getLegend`
 * returns. Every field is present whatever the type, so a consumer reads it
 * without testing for absent keys.
 */
export type LayerLegend = {
    type: LegendType
    /**
     * Gradient only: the ramp's colors in order, already resolved to CSS
     * colors. Null when nothing could resolve them.
     */
    stops: string[] | null
    /**
     * The scale's bounds. Null where the layer declares none — nothing stands
     * in for an unconfigured bound, so a label renders blank rather than
     * announcing a range the layer was never scaled to.
     */
    min: number | null
    max: number | null
    unit: { label: string } | null
    /** Categorical only: the labelled swatches, in order. */
    swatches: LegendSwatch[] | null
    /**
     * The COG colormap the gradient was sampled from, `_r` suffix and all.
     * Null for a legend that came from the layer's own `_legend` rather than
     * from a colormap.
     */
    colormap: string | null
}

export const NO_LEGEND: LayerLegend = {
    type: 'none',
    stops: null,
    min: null,
    max: null,
    unit: null,
    swatches: null,
    colormap: null,
}
