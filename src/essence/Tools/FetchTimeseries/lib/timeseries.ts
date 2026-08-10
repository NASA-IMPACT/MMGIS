// Pure logic for the FetchTimeseries plugin: read a layer's timeseries
// config, build the fetch URL from the clicked feature, and map the response
// into the shared chart-series payload. No MMGIS, no DOM, no fetch — the
// tool entry owns I/O, everything here is unit-testable.

import type {
    ChartPoint,
    ChartSeriesPayload,
} from '../../_shared/types/chartSeries'

/** Per-layer opt-in, authored at `layer.variables.timeseries`. Only `url` is
 *  required — everything else has conventions (see mapResponse). */
export interface TimeseriesConfig {
    /** Set false to turn the block off without deleting it (default true). */
    enabled?: boolean
    /** Fetch URL template; placeholders: {id}, {properties.<key>}, {lon}, {lat}. */
    url: string
    /** Feature property used as the chart title (default: name → title → id). */
    titleProp?: string
    /** Series label (default: the layer's display name). */
    label?: string
    yLabel?: string
    /** Dot-path to the point array in the response (default: auto-detect,
     *  including GeoJSON FeatureCollections via their `features` array). */
    seriesPath?: string
    /** Dot-path to the time value within each point (default: common names,
     *  probed at the top level and under `properties.`). */
    xKey?: string
    /** Dot-path to the numeric value within each point (same defaults). */
    yKey?: string
    /** Dot-path whose distinct values split points into one series each
     *  (e.g. 'properties.parameter' for OGC observation collections). */
    groupBy?: string
    /** Dot-path to a point's measurement unit (e.g.
     *  'properties.units_of_measure'); carried onto each series. */
    unitKey?: string
}

export interface FeatureLike {
    id?: string | number
    properties?: Record<string, unknown>
    geometry?: { type?: string; coordinates?: unknown }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** The layer's timeseries block, or null when the layer doesn't opt in
 *  (a click on such a layer must do nothing — no fetch, no empty chart). */
export function getTimeseriesConfig(layer: unknown): TimeseriesConfig | null {
    if (!isRecord(layer)) return null
    const variables = layer.variables
    if (!isRecord(variables)) return null
    const ts = variables.timeseries
    if (!isRecord(ts)) return null
    if (ts.enabled === false) return null
    if (typeof ts.url !== 'string' || ts.url === '') return null
    return ts as unknown as TimeseriesConfig
}

export class TemplateError extends Error {}

/**
 * Substitutes feature values into the URL template. Values are URL-encoded.
 * An unresolvable placeholder throws TemplateError naming it — an eligible
 * layer with a bad template is a visible error, not a silent no-op.
 */
export function templateUrl(template: string, feature: FeatureLike): string {
    return template.replace(/{([^}]+)}/g, (whole, rawKey: string) => {
        const key = rawKey.trim()
        let value: unknown
        if (key === 'id') {
            value = feature.id
        } else if (key === 'lon' || key === 'lat') {
            const coords =
                feature.geometry?.type === 'Point'
                    ? (feature.geometry.coordinates as unknown[])
                    : null
            value = Array.isArray(coords)
                ? coords[key === 'lon' ? 0 : 1]
                : undefined
        } else if (key.startsWith('properties.')) {
            value = feature.properties?.[key.slice('properties.'.length)]
        } else {
            throw new TemplateError(
                `Unsupported placeholder {${key}} in timeseries URL`,
            )
        }
        if (value == null || value === '') {
            throw new TemplateError(
                `Timeseries URL needs {${key}} but the clicked feature has no such value`,
            )
        }
        return encodeURIComponent(String(value))
    })
}

/** Feature-derived chart title: configured property → name → title → id. */
export function featureTitle(
    feature: FeatureLike,
    config: TimeseriesConfig,
    fallback: string,
): string {
    const props = feature.properties ?? {}
    const candidates = [
        config.titleProp != null ? props[config.titleProp] : undefined,
        props.name,
        props.title,
        feature.id,
    ]
    for (const c of candidates) {
        if (typeof c === 'string' && c !== '') return c
        if (typeof c === 'number') return String(c)
    }
    return fallback
}

const X_KEYS = ['datetime', 'date', 'time', 'timestamp', 't', 'x']
const Y_KEYS = ['value', 'y', 'mean', 'val']
const CONTAINER_KEYS = ['data', 'values', 'timeseries', 'items', 'results', 'features']

function dotGet(obj: unknown, path: string): unknown {
    let cur: unknown = obj
    for (const part of path.split('.')) {
        if (!isRecord(cur)) return undefined
        cur = cur[part]
    }
    return cur
}

// Some feature APIs (e.g. tipg) serve GeoJSON features or flat rows for the
// same items depending on content negotiation; a configured path written
// against one shape resolves against the other by adding or stripping the
// `properties.` prefix.
function dotGetLoose(obj: unknown, path: string): unknown {
    const direct = dotGet(obj, path)
    if (direct !== undefined) return direct
    if (path.startsWith('properties.')) {
        return dotGet(obj, path.slice('properties.'.length))
    }
    return dotGet(obj, `properties.${path}`)
}

function findContainer(response: unknown, seriesPath?: string): unknown {
    if (seriesPath) return dotGet(response, seriesPath)
    if (Array.isArray(response)) return response
    if (isRecord(response)) {
        for (const key of CONTAINER_KEYS) {
            if (Array.isArray(response[key])) return response[key]
        }
    }
    return undefined
}

/** Resolves a point key as a dot-path; auto-detection probes candidates at
 *  the item's top level and one level down under `properties.` — the latter
 *  makes GeoJSON observation features work with zero config. */
function pickKey(
    sample: Record<string, unknown>,
    configured: string | undefined,
    candidates: string[],
): string | null {
    if (configured) return configured
    for (const key of candidates) {
        if (key in sample) return key
    }
    if (isRecord(sample.properties)) {
        for (const key of candidates) {
            if (key in sample.properties) return `properties.${key}`
        }
    }
    return null
}

function toY(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value !== '') {
        const n = Number(value)
        if (Number.isFinite(n)) return n
    }
    return null
}

export class MappingError extends Error {}

export interface MappedSeries {
    /** Distinct groupBy value; '' for the ungrouped single series. */
    key: string
    unit?: string
    points: ChartPoint[]
}

/**
 * Maps a fetched response into one or more point series. Supported shapes:
 *  - an array of point objects (x/y dot-path keys configured or
 *    auto-detected, including under `properties.`), found directly, under a
 *    common container key (`data`, `features`, …), or at `seriesPath`;
 *    `groupBy` splits it into one series per distinct value;
 *  - parallel arrays: a container object whose `xKey`/`yKey` name two
 *    equal-length arrays.
 * Unusable shapes throw MappingError with a user-facing message.
 */
export function mapResponseSeries(
    response: unknown,
    config: TimeseriesConfig,
): MappedSeries[] {
    const container = findContainer(response, config.seriesPath)

    if (Array.isArray(container)) {
        const objects = container.filter(isRecord)
        if (objects.length === 0) {
            throw new MappingError('No data points in the response')
        }
        const xKey = pickKey(objects[0], config.xKey, X_KEYS)
        const yKey = pickKey(objects[0], config.yKey, Y_KEYS)
        if (xKey == null || yKey == null) {
            throw new MappingError(
                'Could not find time/value keys in the response — set xKey/yKey in the layer timeseries config',
            )
        }
        const groups = new Map<string, MappedSeries>()
        for (const item of objects) {
            const x = dotGetLoose(item, xKey)
            if (typeof x !== 'string' && typeof x !== 'number') continue
            const rawKey = config.groupBy ? dotGetLoose(item, config.groupBy) : ''
            const key = rawKey == null ? '' : String(rawKey)
            let group = groups.get(key)
            if (!group) {
                const rawUnit = config.unitKey
                    ? dotGetLoose(item, config.unitKey)
                    : undefined
                group = {
                    key,
                    unit:
                        typeof rawUnit === 'string' && rawUnit !== ''
                            ? rawUnit
                            : undefined,
                    points: [],
                }
                groups.set(key, group)
            }
            group.points.push({ x, y: toY(dotGetLoose(item, yKey)) })
        }
        const series = [...groups.values()].filter((g) => g.points.length > 0)
        if (series.length === 0) {
            throw new MappingError('No data points in the response')
        }
        return series
    }

    if (isRecord(container) && config.xKey && config.yKey) {
        const xs = container[config.xKey]
        const ys = container[config.yKey]
        if (Array.isArray(xs) && Array.isArray(ys) && xs.length === ys.length) {
            const points: ChartPoint[] = []
            for (let i = 0; i < xs.length; i++) {
                const x = xs[i]
                if (typeof x !== 'string' && typeof x !== 'number') continue
                points.push({ x, y: toY(ys[i]) })
            }
            if (points.length > 0) return [{ key: '', points }]
        }
    }

    throw new MappingError(
        'Unrecognized response shape — set seriesPath/xKey/yKey in the layer timeseries config',
    )
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** The full seriesReady payload for one fetched feature. One series per
 *  groupBy value (e.g. per measured parameter); ungrouped responses yield a
 *  single series labeled from config or the layer. */
export function buildPayload(args: {
    chartId: string
    response: unknown
    config: TimeseriesConfig
    title: string
    layerDisplayName: string
    layerName: string
    featureId?: string | number
}): ChartSeriesPayload {
    const mapped = mapResponseSeries(args.response, args.config)
    return {
        chartId: args.chartId,
        title: args.title,
        subtitle: args.layerDisplayName,
        xType: 'time',
        yLabel: args.config.yLabel,
        series: mapped.map((m) => ({
            id: m.key === '' ? 'timeseries' : slug(m.key) || 'series',
            label:
                m.key !== ''
                    ? m.key
                    : args.config.label || args.layerDisplayName,
            unit: m.unit,
            points: m.points,
        })),
        meta: {
            sourcePlugin: 'fetch-timeseries',
            layerName: args.layerName,
            featureId: args.featureId,
        },
    }
}
