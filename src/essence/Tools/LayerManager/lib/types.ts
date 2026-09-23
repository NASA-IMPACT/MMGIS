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
}

export type ForecastRun = {
  /** When the model ran, ISO datetime as the service lists it (naive = UTC). */
  datetime: string
}

export type ForecastData = {
  /** Model runs core offers, newest first. */
  runs: ForecastRun[]
  /** The run core has pinned the layer to. */
  selectedRun: string | null
  /** One lead unit as an ISO 8601 duration: PT1H, P1D, P1M, ... */
  step: string
  /** Whole steps from the pinned run to the timeline's current time. */
  lead: number | null
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
  // true while the host has no data for the layer at the selected time
  outOfDataRange?: boolean
  // true when the layer opts into area analysis, as the analysis plugins read it
  analysisSupported?: boolean
  // present when core reports model runs for the layer
  forecast?: ForecastData | null
}
