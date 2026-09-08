export type LegendType = 'gradient' | 'categorical' | 'text' | 'none'

export type CategoricalStop = { color: string; label: string }

export type CogData = {
    isCog: true
    /**
     * Whether the colormap and rescale can be changed, as opposed to only shown.
     * False for a layer that paints from a COG colormap baked in at construction
     * — an `image` layer — which gets the ramp and its bounds but no controls.
     */
    editable: boolean
    colormap: string
    /**
     * The rescale bounds currently applied, or null where the mission
     * configured none — nothing stands in for an unconfigured bound, so a
     * legend renders it blank rather than inventing a range.
     */
    min: number | null
    max: number | null
    /** Bounds to reset to, and the seed for the rescale control's fields. */
    defaultMin: number
    defaultMax: number
    defaultColormap: string
    units: string | null
    titilerUrl: string | null
}

export type Layer = {
    id: string
    title: string
    description: string | null
    opacity: number
    visible: boolean
    type: LegendType
    // gradient fields
    stops?: string[] | null
    min?: number | null
    max?: number | null
    unit?: { label: string } | null
    // categorical fields
    categoricalStops?: CategoricalStop[]
    // optional COG controls
    cog: CogData | null
}
