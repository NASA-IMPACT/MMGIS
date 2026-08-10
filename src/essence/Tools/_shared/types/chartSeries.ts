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
    /** Measurement unit (e.g. "Parts per million"). When a payload carries
     *  exactly two distinct units, the chart puts the second on a right-hand
     *  y-axis so mixed-magnitude series stay readable. */
    unit?: string
}

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
    subtitle?: string
    xType: 'time' | 'linear' | 'category'
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

/** Event-name suffixes, exported for docs/tests. */
export const SERIES_EVENT_SUFFIXES = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
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
    return (
        typeof value.chartId === 'string' &&
        value.chartId !== '' &&
        typeof value.title === 'string' &&
        (value.xType === 'time' ||
            value.xType === 'linear' ||
            value.xType === 'category') &&
        Array.isArray(value.series) &&
        value.series.length > 0 &&
        value.series.every(isChartSeries)
    )
}
