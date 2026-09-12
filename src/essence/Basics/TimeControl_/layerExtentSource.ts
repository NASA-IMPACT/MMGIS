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
 * of an array, flattened one level. Filters, recursive descent and quoted
 * keys are invalid and match nothing.
 */
const SEGMENT_RE = /^([^.[\]]+)|^\[(\d+|\*)\]/

type Segment = { key: string } | { index: number } | { all: true }

function parsePath(path: string): Segment[] | null {
    let rest = path.trim()
    if (rest.startsWith('$.')) rest = rest.slice(2)
    else if (rest.startsWith('$')) rest = rest.slice(1)
    // A path begins with a key: a bare index or a leading dot has no object
    // to apply to, so `$..a`, `$[0]` and `[0]` are all invalid.
    if (rest === '' || rest.startsWith('[') || rest.startsWith('.')) return null

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
        if (m[1] != null) segments.push({ key: m[1] })
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
 * A fan-out that leaves no elements matches nothing.
 */
export function readPath(json: unknown, path: string): unknown {
    const segments = parsePath(path)
    if (segments == null) return undefined

    let fannedOut = false
    let current: unknown = json
    for (const segment of segments) {
        if (fannedOut) {
            const next = (current as unknown[])
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

// Seconds are the finest the static fields carry, so the fraction is dropped.
function epochToIso(ms: number): string | null {
    const date = new Date(ms)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('.')[0] + 'Z'
}

/**
 * A single time value in the form the static start/end fields hold: a
 * string exactly as written — the existing readers already accept ISO
 * datetimes, partial dates and `now` policies — or a finite number read as
 * epoch milliseconds. Anything else is null.
 */
function normalizeTimeValue(v: unknown): string | null {
    if (isNonEmptyString(v)) return v
    if (typeof v === 'number' && Number.isFinite(v)) return epochToIso(v)
    return null
}

function normalizeInterval(v: unknown): string | null {
    return isNonEmptyString(v) ? v : null
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
