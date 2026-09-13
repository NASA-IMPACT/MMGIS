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
 * engine or the layer registry. Paths are read with the same `F_.getIn`
 * every other dotted config path goes through.
 */

import F_ from '../Formulae_/Formulae_'

/**
 * The value a dotted path names inside `json`, read the way every other
 * dotted path in a layer config is read (`F_.getIn`): keys separated by
 * dots, a numeric key addressing an array position (`interval.0.1`), and
 * whitespace around each key ignored. Undefined when the path is blank or
 * names nothing. A value that is null reads as nothing too: the reader
 * cannot tell the two apart, and neither is usable.
 */
export function readPath(json: unknown, path: string): unknown {
    const keys = String(path ?? '')
        .split('.')
        .map((key) => key.trim())
    if (keys.length === 1 && keys[0] === '') return undefined
    const found = F_.getIn(json, keys)
    return found == null ? undefined : found
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
 * configured and is silently left alone. A configured path that names
 * nothing or yields an unaccepted value leaves its field at the static value
 * and is reported in `skipped` so the caller can warn once.
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
        const value = found === undefined ? null : NORMALIZE[field](found)
        if (value == null) {
            report.skipped.push(
                `${field}: path "${path}" matched nothing usable as a ${field}`
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

/**
 * A relative URL names a file shipped with the mission and is resolved
 * against the mission folder, the way a legend path is. A URL with a
 * scheme, a `//` host or a leading `/` is fetched as written.
 */
function resolveSourceUrl(url: string, missionPath?: string | null): string {
    if (!missionPath || url.startsWith('/') || F_.isUrlAbsolute(url)) return url
    return missionPath + url
}

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
 * `missionPath` is the folder relative URLs resolve against; `fetchImpl`
 * and `timeoutMs` are injectable for tests.
 */
export async function fetchLayerExtentSource(
    layer: ExtentSourceLayer,
    options: {
        timeoutMs?: number
        fetchImpl?: typeof fetch
        missionPath?: string | null
    } = {}
): Promise<ApplyReport | null> {
    const time = layer?.time
    if (time == null || time.enabled !== true) return null
    const configuredUrl = String(time.extentSource?.url ?? '').trim()
    if (configuredUrl === '') return null
    const url = resolveSourceUrl(configuredUrl, options.missionPath)

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
