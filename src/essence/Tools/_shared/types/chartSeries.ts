// The generic chart-series contract between fetcher plugins (FetchTimeseries,
// future raster/forecast fetchers) and the SeriesChart plugin. Fetchers map
// their responses into ChartSeriesPayload; the chart renders it and knows
// nothing about where the data came from. Types only + pure helpers — no
// MMGIS, no DOM.

/** One data point. `x` is an ISO datetime string when xType is 'time';
 *  `y: null` marks a gap the chart must not interpolate across. */
export interface ChartPoint {
    x: string | number
    y: number | null
}

export interface ChartSeries {
    id: string
    label: string
    points: ChartPoint[]
    style?: 'line' | 'area' | 'bar'
    /** CSS color; omitted → chart theme palette. */
    color?: string
    /** Measurement unit (e.g. "Parts per million"), shown in the card
     *  footer next to the variable name. */
    unit?: string
}

/** Reserved provenance block: accepted and carried on the payload, but not
 *  yet read by the chart. */
export interface ChartSeriesMeta {
    /** Plugin id of the emitter, e.g. 'fetch-timeseries'. */
    sourcePlugin?: string
    layerName?: string
    featureId?: string | number
}

export interface ChartSeriesPayload {
    /** Slot identity: a payload with the same chartId replaces the previous
     *  chart; distinct chartIds render as separate cards. */
    chartId: string
    title: string
    /** Reserved: accepted but not yet rendered. */
    subtitle?: string
    xType: 'time' | 'linear' | 'category'
    /** Reserved: accepted but not yet rendered — the card footer chip, not a
     *  y-axis label, names the visible variable and unit. */
    yLabel?: string
    series: ChartSeries[]
    meta?: ChartSeriesMeta
}

export interface SeriesLoadingPayload {
    chartId: string
    /** Optional label shown while loading (e.g. the clicked feature's name). */
    title?: string
}

export interface SeriesErrorPayload {
    chartId: string
    /** Human-readable; rendered verbatim in the chart card. */
    message: string
}

export interface SeriesClearedPayload {
    chartId: string
}

/** `seriesReady` is flat like its three siblings: the event payload IS the
 *  ChartSeriesPayload (chartId at the top level) — there is no envelope. */
export type SeriesReadyPayload = ChartSeriesPayload

const SERIES_EVENT_SUFFIXES = {
    loading: 'seriesLoading',
    ready: 'seriesReady',
    error: 'seriesError',
    cleared: 'seriesCleared',
} as const

export interface SeriesEventNames {
    loading: string
    ready: string
    error: string
    cleared: string
}

/**
 * Full bus event names for a fetcher plugin id, following the established
 * `plugin:<id>:<event>` convention (see FetchStats). The chart's `sources`
 * config lists plugin ids; this maps each id to the events to subscribe to.
 */
export function seriesEvents(pluginId: string): SeriesEventNames {
    const prefix = `plugin:${pluginId}:`
    return {
        loading: prefix + SERIES_EVENT_SUFFIXES.loading,
        ready: prefix + SERIES_EVENT_SUFFIXES.ready,
        error: prefix + SERIES_EVENT_SUFFIXES.error,
        cleared: prefix + SERIES_EVENT_SUFFIXES.cleared,
    }
}

/** Shared plain-object guard — fetcher-side response mapping reuses it, so
 *  it lives here rather than being redefined per plugin. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isChartPoint(value: unknown): value is ChartPoint {
    if (!isRecord(value)) return false
    const xOk = typeof value.x === 'string' || typeof value.x === 'number'
    const yOk = value.y === null || typeof value.y === 'number'
    return xOk && yOk
}

function isChartSeries(value: unknown): value is ChartSeries {
    if (!isRecord(value)) return false
    return (
        typeof value.id === 'string' &&
        value.id !== '' &&
        typeof value.label === 'string' &&
        Array.isArray(value.points) &&
        value.points.every(isChartPoint)
    )
}

/**
 * Guard the chart runs on every incoming `seriesReady` payload — emitters are
 * other plugins, so malformed input must degrade to a console warning, never
 * a crashed panel.
 */
export function isChartSeriesPayload(value: unknown): value is ChartSeriesPayload {
    if (!isRecord(value)) return false
    const shapeOk =
        typeof value.chartId === 'string' &&
        value.chartId !== '' &&
        typeof value.title === 'string' &&
        (value.xType === 'time' ||
            value.xType === 'linear' ||
            value.xType === 'category') &&
        Array.isArray(value.series) &&
        value.series.length > 0 &&
        value.series.every(isChartSeries)
    if (!shapeOk) return false
    // ids key card lists and labels key the legend picker/footer/CSV —
    // duplicates in either collapse picker entries and mislabel the rest,
    // so they're rejected at the boundary like any other malformed payload.
    const series = value.series as ChartSeries[]
    return (
        new Set(series.map((s) => s.id)).size === series.length &&
        new Set(series.map((s) => s.label)).size === series.length
    )
}
