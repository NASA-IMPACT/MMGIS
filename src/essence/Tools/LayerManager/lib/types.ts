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

/** The unit a listed entry names; nothing finer than the hour. */
export type CoverageUnit = 'year' | 'month' | 'day' | 'hour'

/**
 * A span of time in epoch milliseconds, UTC. An open bound is -Infinity or
 * Infinity. A span from a listed entry also carries the `unit` that entry
 * names and its `at` timestamp — the entry as written, any part left out
 * filled with its start — so 14:30 stays 14:30 though the span is the hour.
 */
export type CoverageSpan = {
  start: number
  end: number
  at?: number
  unit?: CoverageUnit
}

/**
 * Whether the host is holding a layer back for lack of data in the window it
 * would request, and the declared coverage that decided it. `outOfDataRange`
 * is only ever true for a time-enabled layer that declares coverage; `kind`
 * is null for any other.
 */
export type DataCoverage = {
  outOfDataRange: boolean
  /** 'sparse' from listed entries, 'continuous' from an extent. */
  kind: 'continuous' | 'sparse' | null
  /** Sparse: one span per listed entry, ordered by start. Continuous: one. */
  spans: CoverageSpan[] | null
  /** The window the layer would request; the instant asked for is its end. */
  requestedWindow: CoverageSpan | null
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
  // flags the row while the host has no data for the layer at this time
  dataCoverage?: DataCoverage | null
}
