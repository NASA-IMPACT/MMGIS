/**
 * A layer's runtime time-extent source: a URL returning JSON plus a path
 * into that JSON for each of the four static data-time fields. Fetched once
 * while the mission's layers load, before any reader sees the layer, and
 * merged onto `layer.time` so every existing reader of `dataStartTime`,
 * `dataEndTime`, `interval` and `dataDates` sees the fetched values without
 * knowing where they came from. The static fields are the fallback for
 * anything the source cannot supply.
 *
 * Pure except for the injected `fetch`; nothing here touches the DOM, an
 * engine or the layer registry.
 */

/**
 * Path grammar, deliberately small: an optional leading `$` or `$.`,
 * dot-separated object keys, `[n]` array indexes and `[*]` for every element
 * of an array, flattened one level (a repeated `[*]` flattens one further
 * level again). A path may begin with an index or a wildcard when the root
 * itself is an array. Filters, recursive descent and quoted keys are invalid
 * and match nothing.
 */
const SEGMENT_RE = /^([^.[\]]+)|^\[(\d+|\*)\]/
const LEADING_INDEX_RE = /^\[(\d+|\*)\]/

type Segment = { key: string } | { index: number } | { all: true }

function parsePath(path: string): Segment[] | null {
    let rest = path.trim()
    if (rest.startsWith('$.')) rest = rest.slice(2)
    else if (rest.startsWith('$')) rest = rest.slice(1)
    // A path begins with a key, or with an index/wildcard addressing an
    // array root; a leading dot or recursive descent has no object to apply
    // to, so `$..a` and a bare `.` are invalid, but `[0]` and `$[0]` are not.
    if (rest === '' || rest.startsWith('.')) return null
    if (rest.startsWith('[') && !LEADING_INDEX_RE.test(rest)) return null

    const segments: Segment[] = []
    while (rest.length > 0) {
        // A dot separates a key from what precedes it; a dot followed by
        // nothing, another dot or an index is malformed.
        if (rest.startsWith('.')) {
            rest = rest.slice(1)
            if (rest === '' || rest.startsWith('.') || rest.startsWith('['))
                return null
        }
        const m = SEGMENT_RE.exec(rest)
        if (!m) return null
        if (m[1] != null) segments.push({ key: m[1].trim() })
        else if (m[2] === '*') segments.push({ all: true })
        else segments.push({ index: Number(m[2]) })
        rest = rest.slice(m[0].length)
    }
    return segments
}

function step(value: unknown, segment: Segment): unknown {
    if (value == null) return undefined
    if ('all' in segment) {
        return Array.isArray(value) && value.length > 0 ? value : undefined
    }
    if ('index' in segment) {
        return Array.isArray(value) ? value[segment.index] : undefined
    }
    if (typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[segment.key]
}

/**
 * The value a path names inside `json`, or undefined when the path is
 * invalid or matches nothing. A `[*]` fans out: every later segment is
 * applied to each element, and elements that match nothing are dropped.
 * A `[*]` reached while already fanned out flattens one further level
 * instead — the elements of each element are concatenated, and elements
 * that are not themselves arrays are dropped. A fan-out that leaves no
 * elements matches nothing.
 */
export function readPath(json: unknown, path: string): unknown {
    const segments = parsePath(path)
    if (segments == null) return undefined

    let fannedOut = false
    let current: unknown = json
    for (const segment of segments) {
        if (fannedOut) {
            const next =
                'all' in segment
                    ? (current as unknown[]).flatMap((el) =>
                          Array.isArray(el) ? el : []
                      )
                    : (current as unknown[])
                          .map((el) => step(el, segment))
                          .filter((v) => v !== undefined)
            if (next.length === 0) return undefined
            current = next
        } else {
            current = step(current, segment)
            if (current === undefined) return undefined
            if ('all' in segment) fannedOut = true
        }
    }
    return current
}

export interface ExtentSource {
    url?: string | null
    startPath?: string | null
    endPath?: string | null
    intervalPath?: string | null
    datesPath?: string | null
}

export interface LayerTime {
    enabled?: boolean
    dataStartTime?: string | null
    dataEndTime?: string | null
    interval?: string | null
    dataDates?: string[] | string | null
    extentSource?: ExtentSource | null
    [key: string]: unknown
}

export interface ApplyReport {
    /** Fields overwritten from the source. */
    applied: string[]
    /** One reason per configured field left at its static value. */
    skipped: string[]
}

type Field = 'dataStartTime' | 'dataEndTime' | 'interval' | 'dataDates'

const PATH_FOR: Record<Field, keyof ExtentSource> = {
    dataStartTime: 'startPath',
    dataEndTime: 'endPath',
    interval: 'intervalPath',
    dataDates: 'datesPath',
}

const isNonEmptyString = (v: unknown): v is string =>
    typeof v === 'string' && v !== ''

// The charset every string this module writes into a layer's time fields is
// restricted to: digits, letters, `:`, `+`, `-`, `.` and whitespace. That
// covers every form the existing readers parse — ISO datetimes and partial
// dates, `now` policies and ISO durations — with no room for markup, since
// these strings are later concatenated into HTML by the Layers tool.
const SAFE_TIME_STRING_RE = /^[0-9A-Za-z:+\-.\s]+$/

const isSafeTimeString = (v: unknown): v is string =>
    isNonEmptyString(v) && SAFE_TIME_STRING_RE.test(v)

// Seconds are the finest the static fields carry, so the fraction is dropped.
function epochToIso(ms: number): string | null {
    const date = new Date(ms)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('.')[0] + 'Z'
}

/**
 * A single time value in the form the static start/end fields hold: a
 * string exactly as written — the existing readers already accept ISO
 * datetimes, partial dates and `now` policies, and the safe charset covers
 * all of them — or a finite number read as epoch milliseconds. Anything
 * else, including a string outside that charset, is null.
 */
function normalizeTimeValue(v: unknown): string | null {
    if (isSafeTimeString(v)) return v
    if (typeof v === 'number' && Number.isFinite(v)) return epochToIso(v)
    return null
}

function normalizeInterval(v: unknown): string | null {
    return isSafeTimeString(v) ? v : null
}

/**
 * The dates list: an array keeps its string and finite-number entries and
 * drops the rest; a lone scalar is a one-entry list. Null when nothing
 * usable remains.
 */
function normalizeDates(v: unknown): string[] | null {
    const raw = Array.isArray(v) ? v : [v]
    const dates = raw
        .map((entry) => normalizeTimeValue(entry))
        .filter((d): d is string => d != null)
    return dates.length > 0 ? dates : null
}

const NORMALIZE: Record<Field, (v: unknown) => string | string[] | null> = {
    dataStartTime: normalizeTimeValue,
    dataEndTime: normalizeTimeValue,
    interval: normalizeInterval,
    dataDates: normalizeDates,
}

/**
 * Overwrites each of the four static data-time fields on `time` whose
 * configured path yields an accepted value in `json`. A blank path is not
 * configured and is silently left alone. A configured path that is invalid,
 * matches nothing or yields an unaccepted value leaves its field at the
 * static value and is reported in `skipped` so the caller can warn once.
 */
export function applyExtentSource(time: LayerTime, json: unknown): ApplyReport {
    const report: ApplyReport = { applied: [], skipped: [] }
    const source = time?.extentSource
    if (source == null) return report

    const configured = (Object.keys(PATH_FOR) as Field[]).filter((field) =>
        isNonEmptyString(String(source[PATH_FOR[field]] ?? '').trim())
    )
    if (configured.length === 0) return report

    if (json == null || typeof json !== 'object') {
        report.skipped.push(
            `response is not a JSON object or array, so no field was applied`
        )
        return report
    }

    configured.forEach((field) => {
        const path = String(source[PATH_FOR[field]]).trim()
        const found = readPath(json, path)
        if (found === undefined) {
            report.skipped.push(
                `${field}: path "${path}" is invalid or matched nothing`
            )
            return
        }
        const value = NORMALIZE[field](found)
        if (value == null) {
            report.skipped.push(
                `${field}: path "${path}" yielded a value that is not usable as a ${field}`
            )
            return
        }
        // The four fields have different declared types, so a write through
        // the union key goes via the index signature.
        ;(time as Record<string, unknown>)[field] = value
        report.applied.push(field)
    })
    return report
}

export interface ExtentSourceLayer {
    name?: string
    display_name?: string
    time?: LayerTime | null
}

const DEFAULT_TIMEOUT_MS = 10000

function labelOf(layer: ExtentSourceLayer): string {
    return layer.display_name || layer.name || '(unnamed layer)'
}

/**
 * Fetches a layer's configured extent source and merges the result onto its
 * `time` block. Resolves to the merge report, or null when the layer has no
 * enabled time block, no source URL, or the fetch failed — a network error,
 * a non-2xx status, a non-JSON body or the timeout elapsing. Every failure,
 * and every configured field the response could not supply, is reported in
 * one console warning naming the layer. Never rejects: a broken source may
 * cost the layer its fetched extent, never its place on the map.
 *
 * `fetchImpl` and `timeoutMs` are injectable for tests.
 */
export async function fetchLayerExtentSource(
    layer: ExtentSourceLayer,
    options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ApplyReport | null> {
    const time = layer?.time
    if (time == null || time.enabled !== true) return null
    const url = String(time.extentSource?.url ?? '').trim()
    if (url === '') return null

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const label = labelOf(layer)

    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let json: unknown
    try {
        const fetchImpl = options.fetchImpl ?? fetch
        controller = new AbortController()
        timer = setTimeout(() => controller!.abort(), timeoutMs)
        const response = await fetchImpl(url, { signal: controller.signal })
        if (!response.ok) {
            console.warn(
                `[Layers] ${label}: time extent source ${url} responded ${response.status}; using the configured data times.`
            )
            return null
        }
        json = await response.json()
    } catch (err) {
        const reason = controller?.signal.aborted
            ? `timed out after ${timeoutMs} ms`
            : `could not be fetched or parsed as JSON (${
                  (err as Error)?.message ?? err
              })`
        console.warn(
            `[Layers] ${label}: time extent source ${url} ${reason}; using the configured data times.`
        )
        return null
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }

    const report = applyExtentSource(time, json)
    if (report.skipped.length > 0) {
        console.warn(
            `[Layers] ${label}: time extent source ${url} left these at their configured values:\n  ` +
                report.skipped.join('\n  ')
        )
    }
    return report
}
