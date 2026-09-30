// Pure logic for the FetchTimeseries plugin: read a layer's timeseries
// config, build the fetch URL from the clicked feature, and map the response
// into the shared chart-series payload. No MMGIS, no DOM, no fetch — the
// tool entry owns I/O, everything here is unit-testable.

import {
    isRecord,
    type ChartPoint,
    type ChartSeriesPayload,
} from '../../_shared/types/chartSeries'

/** Per-layer opt-in, authored at `layer.variables.timeseries`. Only `url` is
 *  required — the shape fields default to the GeoJSON FeatureCollection an
 *  OGC features API returns. */
export interface TimeseriesConfig {
    /** Set false to turn the block off without deleting it (default true). */
    enabled?: boolean
    /** Fetch URL template; placeholders: {id}, {properties.<key>}, {lon}, {lat}. */
    url: string
    /** Feature property used as the chart title (default: name → title → id). */
    titleProp?: string
    /** Series label (default: the layer's display name). */
    label?: string
    /** Dot-path to the point array when the response is an object (default
     *  `features`). Ignored when the response is itself an array. */
    seriesPath?: string
    /** Dot-path to the time value within each point (default `datetime`),
     *  resolved at the point's top level and under `properties.`. Values are
     *  ISO datetime strings or epoch milliseconds. */
    xKey?: string
    /** Dot-path to the numeric value within each point (default `value`). */
    yKey?: string
    /** Dot-path whose distinct values split points into one series each
     *  (e.g. 'properties.parameter' for OGC observation collections). */
    groupBy?: string
    /** Dot-path to a point's measurement unit (e.g.
     *  'properties.units_of_measure'); carried onto each series. */
    unitKey?: string
    /** How far back from the latest data the card's range opens: '1 hour',
     *  '1 day', '1 week', '1 month' or '1 year' (default), or an ISO
     *  duration such as P7D. */
    defaultSpan?: string
}

export interface FeatureLike {
    id?: string | number
    properties?: Record<string, unknown>
    geometry?: { type?: string; coordinates?: unknown }
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

/** The viewer's range, two ISO instants `YYYY-MM-DDTHH:MM:SS` read as UTC. */
export interface DateRange {
    start: string
    end: string
}

export const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export type SpanUnit = 'hour' | 'day' | 'week' | 'month' | 'year'
/** How far back from the latest data the card's range opens. */
export interface Span {
    amount: number
    unit: SpanUnit
}
export const DEFAULT_SPAN: Span = { amount: 1, unit: 'year' }

const UNIT_WORDS: Record<string, SpanUnit> = {
    hour: 'hour', hours: 'hour', h: 'hour',
    day: 'day', days: 'day', d: 'day',
    week: 'week', weeks: 'week', w: 'week',
    month: 'month', months: 'month',
    year: 'year', years: 'year', y: 'year',
}

/** Reads a configured span: the Configure options ('1 day', plurals
 *  tolerated) or an ISO duration in one unit (PT6H, P7D, P2W, P1M, P1Y).
 *  Anything else is null, and the caller falls back to a year. */
export function parseSpan(value: unknown): Span | null {
    if (typeof value !== 'string') return null
    const v = value.trim()
    let m = v.toLowerCase().match(/^(\d+)\s*([a-z]+)$/)
    if (m && UNIT_WORDS[m[2]] && Number(m[1]) >= 1) {
        return { amount: Number(m[1]), unit: UNIT_WORDS[m[2]] }
    }
    m = v.toUpperCase().match(/^P(?:T(\d+)H|(\d+)D|(\d+)W|(\d+)M|(\d+)Y)$/)
    if (m) {
        const [h, d, w, mo, y] = m.slice(1)
        const pick: Array<[string | undefined, SpanUnit]> = [
            [h, 'hour'], [d, 'day'], [w, 'week'], [mo, 'month'], [y, 'year'],
        ]
        for (const [n, unit] of pick) if (n && Number(n) >= 1) return { amount: Number(n), unit }
    }
    return null
}

/** UTC, to the second, without the zone suffix: what datetime-local holds. */
export const isoInstant = (d: Date) => d.toISOString().slice(0, 19)
export const startOfUtcDay = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
export const endOfUtcDay = (d: Date) =>
    new Date(startOfUtcDay(d).getTime() + DAY_MS - 1000)

const parseInstant = (value: string | null | undefined): Date | null => {
    if (!value) return null
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

/** One side of a seeded range, from the layer's extent or the mission window. */
export interface RangeSource {
    start: string | null
    end: string | null
}

/**
 * `end` minus the span. Hours keep the clock; days and weeks land on the
 * start of their UTC day; months and years step the calendar with the day
 * clamped to the target month's length, so Mar 31 minus a month is Feb 28.
 */
export function subtractSpan(end: Date, span: Span): Date {
    const { amount, unit } = span
    if (unit === 'hour') return new Date(end.getTime() - amount * HOUR_MS)
    if (unit === 'day' || unit === 'week') {
        const days = unit === 'week' ? amount * 7 : amount
        return startOfUtcDay(new Date(end.getTime() - days * DAY_MS))
    }
    const year = end.getUTCFullYear() - (unit === 'year' ? amount : 0)
    const month = end.getUTCMonth() - (unit === 'month' ? amount : 0)
    const first = new Date(Date.UTC(year, month, 1))
    const monthEnd = new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate()
    return new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(end.getUTCDate(), monthEnd)),
    )
}

/**
 * The range the card opens with. The layer's own data extent comes first,
 * side by side; a side it leaves open comes from the mission window, and
 * failing that from today. An end in the future is capped at the end of
 * today. The start is the later of the extent's start and `end` minus the
 * span (a year unless the layer says otherwise): the whole extent when it
 * is shorter than the span, the last span of it when longer.
 */
export function seedRange(args: {
    extent?: RangeSource | null
    window?: RangeSource | null
    now: Date
    span?: Span | null
}): DateRange {
    const span = args.span ?? DEFAULT_SPAN
    const today = endOfUtcDay(args.now)
    let start = parseInstant(args.extent?.start)
    let end = parseInstant(args.extent?.end)
    if (end && end > today) end = today
    if (!start || !end) {
        const ws = parseInstant(args.window?.start)
        const we = parseInstant(args.window?.end)
        if (ws && we && ws <= we) {
            start = start ?? ws
            end = end ?? we
        }
    }
    if (!end) end = today
    const floor = subtractSpan(end, span)
    if (!start || start > end || start < floor) start = floor
    return { start: isoInstant(start), end: isoInstant(end) }
}

/**
 * Substitutes feature values into the URL template. Values are URL-encoded.
 * An unresolvable placeholder throws TemplateError naming it — an eligible
 * layer with a bad template is a visible error, not a silent no-op.
 * Braces are placeholder syntax; a literal `{`/`}` in the URL is not
 * supported.
 *
 * `{lon}`/`{lat}` prefer the feature's own Point coordinates but fall back
 * to the click location — the vector-tile and deck.gl click paths hand over
 * features with empty geometry, so the event's latlng is the coordinate
 * source that always exists.
 *
 * `{start}`/`{end}` are the card's instants, exactly as held: the layer
 * author writes the service's own range syntax around them (a `datetime=`
 * parameter, a CQL2 comparison, custom parameters), so the plugin never
 * assumes one.
 */
export function templateUrl(
    template: string,
    feature: FeatureLike,
    latlng?: { lat: number; lng: number } | null,
    range?: DateRange | null,
): string {
    return template.replace(/{([^}]+)}/g, (whole, rawKey: string) => {
        const key = rawKey.trim()
        let value: unknown
        if (key === 'id') {
            value = feature.id
        } else if (key === 'start' || key === 'end') {
            value = range?.[key]
        } else if (key === 'lon' || key === 'lat') {
            const coords =
                feature.geometry?.type === 'Point'
                    ? (feature.geometry.coordinates as unknown[])
                    : null
            value = Array.isArray(coords)
                ? coords[key === 'lon' ? 0 : 1]
                : latlng != null
                  ? key === 'lon'
                      ? latlng.lng
                      : latlng.lat
                  : undefined
        } else if (key.startsWith('properties.')) {
            value = dotGet(
                feature.properties,
                key.slice('properties.'.length),
            )
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
        if (typeof value === 'object') {
            throw new TemplateError(
                `Timeseries URL {${key}} resolved to a non-scalar value`,
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

const DEFAULT_SERIES_PATH = 'features'
const DEFAULT_X_KEY = 'datetime'
const DEFAULT_Y_KEY = 'value'

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

/** The point array: the response itself when it is one, else the array at
 *  `seriesPath`. Anything else is a shape this plugin does not read, named
 *  so the config can be corrected rather than read as "no data". */
function pointsOf(response: unknown, seriesPath: string): unknown[] {
    const container = Array.isArray(response)
        ? response
        : dotGet(response, seriesPath)
    if (!Array.isArray(container)) {
        throw new MappingError(
            `No point array at '${seriesPath}' in the response — set seriesPath in the layer timeseries config`,
        )
    }
    return container
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

/** What an OGC Features page says about the rest of the answer. All null
 *  for a bare array or an object without the standard members. */
export interface PageInfo {
    next: string | null
    matched: number | null
    returned: number | null
}

export function pageInfo(response: unknown): PageInfo {
    if (!isRecord(response)) return { next: null, matched: null, returned: null }
    const links = Array.isArray(response.links) ? response.links : []
    const next = links.find(
        (l) => isRecord(l) && l.rel === 'next' && typeof l.href === 'string',
    ) as { href: string } | undefined
    const count = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : null
    return {
        next: next?.href ?? null,
        matched: count(response.numberMatched),
        returned: count(response.numberReturned),
    }
}

function withArrayAt(
    obj: Record<string, unknown>,
    path: string,
    points: unknown[],
): Record<string, unknown> {
    const [head, ...tail] = path.split('.')
    if (tail.length === 0) return { ...obj, [head]: points }
    const child = obj[head]
    return {
        ...obj,
        [head]: withArrayAt(isRecord(child) ? child : {}, tail.join('.'), points),
    }
}

/** The first page with every page's points concatenated into its point
 *  array, so the mapper sees one response, and numberReturned raised to the
 *  merged count so the truncation notice knows the walk completed. A page
 *  without the array is the same MappingError a single response would raise. */
export function mergePages(
    first: unknown,
    rest: unknown[],
    config: TimeseriesConfig,
): unknown {
    if (rest.length === 0) return first
    const seriesPath = config.seriesPath || DEFAULT_SERIES_PATH
    const points = [first, ...rest].flatMap((page) => pointsOf(page, seriesPath))
    if (Array.isArray(first) || !isRecord(first)) return points
    const merged = withArrayAt(first, seriesPath, points)
    return 'numberReturned' in merged ? { ...merged, numberReturned: points.length } : merged
}

export interface MappedSeries {
    /** Distinct groupBy value; '' for the ungrouped single series. */
    key: string
    unit?: string
    points: ChartPoint[]
}

/**
 * Maps a fetched response into one or more point series: an array of point
 * objects, the response itself or the array at `seriesPath`, read through
 * `xKey`/`yKey` (found at the point's top level or under `properties.`) and
 * split by `groupBy` into one series per distinct value. Unusable shapes
 * throw MappingError with a user-facing message.
 */
export function mapResponseSeries(
    response: unknown,
    config: TimeseriesConfig,
): MappedSeries[] {
    const seriesPath = config.seriesPath || DEFAULT_SERIES_PATH
    const xKey = config.xKey || DEFAULT_X_KEY
    const yKey = config.yKey || DEFAULT_Y_KEY

    const objects = pointsOf(response, seriesPath).filter(isRecord)
    if (objects.length === 0) {
        throw new MappingError('No data points in the response')
    }
    // A key that matches nothing is a config problem, and must not
    // masquerade as the API returning no data.
    for (const [name, key] of [
        ['xKey', xKey],
        ['yKey', yKey],
    ] as const) {
        if (!objects.some((o) => dotGetLoose(o, key) !== undefined)) {
            throw new MappingError(
                `${name} '${key}' matches nothing in the response — set ${name} in the layer timeseries config`,
            )
        }
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
    // All-null values would render an empty plot with no explanation —
    // point at the value key instead.
    if (series.every((g) => g.points.every((p) => p.y === null))) {
        throw new MappingError(
            'The response contained no numeric values — check yKey in the layer timeseries config',
        )
    }
    return series
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** OGC feature APIs page by default (often 10 items); a silently truncated
 *  chart presented as the complete record is a data-integrity failure, so
 *  the title carries a "first N of M" notice when the response says more
 *  matched than it returned. */
function truncationNote(response: unknown, pointCount: number): string | null {
    if (!isRecord(response)) return null
    const matched = response.numberMatched
    if (typeof matched !== 'number') return null
    const returned =
        typeof response.numberReturned === 'number'
            ? response.numberReturned
            : pointCount
    return matched > returned ? `first ${returned} of ${matched} points` : null
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
    const pointCount = mapped.reduce((n, m) => n + m.points.length, 0)
    const note = truncationNote(args.response, pointCount)
    // Slugged group keys can collide (e.g. two all-non-ASCII parameter
    // names) and the chart rejects duplicate ids — suffix them apart.
    const usedIds = new Set<string>()
    return {
        chartId: args.chartId,
        title: note ? `${args.title} (${note})` : args.title,
        subtitle: args.layerDisplayName,
        series: mapped.map((m) => {
            const base = m.key === '' ? 'timeseries' : slug(m.key) || 'series'
            let id = base
            for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`
            usedIds.add(id)
            return {
                id,
                label:
                    m.key !== ''
                        ? m.key
                        : args.config.label || args.layerDisplayName,
                unit: m.unit,
                points: m.points,
            }
        }),
        meta: {
            sourcePlugin: 'fetch-timeseries',
            layerName: args.layerName,
            featureId: args.featureId,
        },
    }
}
