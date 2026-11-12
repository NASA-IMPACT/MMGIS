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

/**
 * The host's layer grouping: groups with their children, and layers by id.
 * Order within a level carries no meaning here; the list orders by draw order.
 */
export type LayerStructureNode =
  | { kind: 'group'; id: string; children: LayerStructureNode[] }
  | { kind: 'layer'; id: string }

/** What a group's header shows, keyed by group id beside the structure. */
export type GroupInfo = {
  title: string
  /** Shown from the group's info button; null or absent when it has none. */
  description?: string | null
  /** Starts open when true; otherwise starts collapsed. */
  expanded?: boolean
}

/** A group as the list shows it: only the children left to show. */
export type LayerGroup = GroupInfo & {
  id: string
  children: LayerListNode[]
}

/** One row of a grouped list: a layer, or a group holding more rows. */
export type LayerListNode =
  | { kind: 'layer'; layer: Layer }
  | { kind: 'group'; group: LayerGroup }

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
  // present when core reports model runs for the layer
  forecast?: ForecastData | null
}
