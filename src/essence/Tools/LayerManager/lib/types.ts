export type LegendType = 'gradient' | 'categorical' | 'text' | 'none'

export type CategoricalStop = { color: string; label: string }

/**
 * The colormap controls a raster layer offers, as opposed to the legend it
 * draws. The ramp's bounds and unit are legend fields on the layer itself —
 * the control reads them from there, so a panel can never show a range its
 * legend disagrees with.
 */
export type CogData = {
  /**
   * Whether the colormap and rescale can be changed, as opposed to only shown.
   * False for a layer that paints from a COG colormap baked in at construction
   * — an `image` layer — which gets the ramp and its bounds but no controls.
   */
  editable: boolean
  /** The ramp currently applied, including any `_r` suffix. */
  colormap: string
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
  /** Null where the layer declares no bound; labels render blank rather than 0. */
  min?: number | null
  max?: number | null
  unit?: { label: string } | null
  // categorical fields
  categoricalStops?: CategoricalStop[]
  // optional COG controls
  cog: CogData | null
  // true while the host has no data for the layer at the selected time
  outOfDataRange?: boolean
  // true when the layer opts into area analysis, as the analysis plugins read it
  analysisSupported?: boolean
}
