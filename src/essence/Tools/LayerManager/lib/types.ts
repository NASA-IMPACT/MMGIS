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
  min: number
  max: number
  defaultMin: number
  defaultMax: number
  defaultColormap: string
  units: string | null
  titilerUrl: string | null
  /**
   * Ramps the app can paint without a service, as name -> ordered CSS colors.
   * Supplied as data by core (lib never reaches into the colormap evaluator),
   * and only for a layer the app renders itself — for which it is then the
   * whole ramp vocabulary. Null means this layer's ramps belong to its tiling
   * service, which defines them and paints the pixels they stand for.
   */
  localColormaps: Record<string, string[]> | null
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
  min?: number
  max?: number
  unit?: { label: string } | null
  // categorical fields
  categoricalStops?: CategoricalStop[]
  // optional COG controls
  cog: CogData | null
}
