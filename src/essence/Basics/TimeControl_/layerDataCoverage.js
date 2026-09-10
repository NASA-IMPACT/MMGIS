import moment from 'moment'

/**
 * A layer's declared data coverage, read from its `time` config.
 *
 * Pure: config in, spans out. Nothing here touches the DOM, an engine, or
 * the layer registry, and nothing here produces a sentence — wording and
 * date formatting belong to whatever renders the result.
 *
 * Epoch milliseconds throughout. An open bound is -Infinity / Infinity.
 */

/**
 * The unit an ISO 8601 entry names, read from the format the parser matched
 * it against. Anything finer than the hour is the hour: an hour is the
 * finest step the timeline takes.
 */
function unitOf(format) {
    if (format.includes('HH')) return 'hour'
    if (format.includes('D') || format.includes('E')) return 'day'
    if (format.includes('MM')) return 'month'
    return 'year'
}

/**
 * One configured time, read as `{ start, end, at, unit }`, or null when it is
 * not ISO 8601 or names no unit.
 *
 * `unit` is what the entry names — 2020 a year, 2020-03 a month, 2020-03-04
 * a day, 2020-03-04T14 an hour — and `start`/`end` cover the whole of it.
 * `at` is the entry's own timestamp, any part left out filled with its
 * start, so 2020-03 is 1 March 00:00 and 14:30 stays 14:30 though it covers
 * 14:00–14:59.
 *
 * Read strictly, with surrounding whitespace tolerated, and resolved in UTC;
 * an entry carrying an offset is converted, not dropped.
 */
function readEntry(raw) {
    const time = moment.utc(String(raw).trim(), moment.ISO_8601, true)
    if (!time.isValid()) return null
    const unit = unitOf(time.creationData().format)
    if (unit == null) return null
    return {
        start: time.clone().startOf(unit).valueOf(),
        end: time.clone().endOf(unit).valueOf(),
        at: time.valueOf(),
        unit,
    }
}

/**
 * The entries a layer lists data at, one span per entry, ordered by where
 * each starts and then by its timestamp. An entry listed twice is kept once;
 * entries that overlap or nest are all kept, since each is its own place to
 * move the timeline to. `dataDates` is accepted as a list or as a single
 * bare string, and an unreadable entry costs only itself.
 */
function resolveListedEntries(dataDates) {
    const listed = Array.isArray(dataDates)
        ? dataDates
        : typeof dataDates === 'string'
        ? [dataDates]
        : []

    const byKey = new Map()
    listed.forEach((raw) => {
        const entry = readEntry(raw)
        if (entry) byKey.set(`${entry.unit}|${entry.at}`, entry)
    })

    return [...byKey.values()].sort(
        (a, b) => a.start - b.start || a.at - b.at || a.end - b.end
    )
}

/**
 * One bound of an extent. Absent or unreadable is open. An ISO 8601 bound
 * covers its whole unit, so a start opens at the beginning of what it names
 * and an end closes at the close of it: an end of 2020-03 runs to the last
 * instant of March. Anything else is read leniently as the exact instant it
 * names, because configs carry these bounds in looser formats too.
 */
function resolveBound(raw, open, edge) {
    if (raw == null || raw === '') return open
    if (raw === 'now') return Date.now()
    const entry = readEntry(raw)
    if (entry) return edge === 'start' ? entry.start : entry.end
    const parsed = new Date(raw).getTime()
    return Number.isNaN(parsed) ? open : parsed
}

// time config -> its resolved coverage and the fields it was read from
const resolved = new WeakMap()

/**
 * `{ kind, spans }` for a time-enabled layer that declares coverage, or null
 * for one that places no temporal limit on its requests. A sparse layer's
 * spans each carry the entry's `at` and `unit`; a continuous layer's single
 * span carries neither.
 *
 * Kept per `time` object and read again only when the fields it came from
 * change: this runs for every time-enabled layer on every time step, and a
 * layer may list years of entries. A `now` bound names a moving instant, so
 * an extent carrying one is read afresh each call.
 */
export function resolveDataCoverage(time) {
    if (time?.enabled !== true) return null

    const { dataDates, dataStartTime, dataEndTime } = time
    const hit = resolved.get(time)
    if (
        hit &&
        hit.dataDates === dataDates &&
        hit.dataStartTime === dataStartTime &&
        hit.dataEndTime === dataEndTime
    )
        return hit.coverage

    const coverage = readDataCoverage(time)
    const moving =
        coverage?.kind !== 'sparse' &&
        (dataStartTime === 'now' || dataEndTime === 'now')
    if (!moving)
        resolved.set(time, { dataDates, dataStartTime, dataEndTime, coverage })
    return coverage
}

/**
 * Listed times win over the extent whenever they yield anything: a layer
 * that lists times is sparse, and its extent describes the outer bounds of
 * those times, not continuous coverage between them.
 *
 * An extent whose start is after its end is a span the layer cannot hold
 * data in. It resolves to null with a warning, because ignoring the
 * constraint is the recoverable failure; blanking the layer at every
 * instant is not.
 */
function readDataCoverage(time) {
    const entries = resolveListedEntries(time.dataDates)
    if (entries.length > 0) return { kind: 'sparse', spans: entries }

    const hasStart = time.dataStartTime != null && time.dataStartTime !== ''
    const hasEnd = time.dataEndTime != null && time.dataEndTime !== ''
    if (!hasStart && !hasEnd) return null

    const start = resolveBound(time.dataStartTime, -Infinity, 'start')
    const end = resolveBound(time.dataEndTime, Infinity, 'end')

    if (start > end) {
        console.warn(
            `layerDataCoverage: dataStartTime (${time.dataStartTime}) is after ` +
                `dataEndTime (${time.dataEndTime}); the layer is treated as unconstrained.`
        )
        return null
    }

    return { kind: 'continuous', spans: [{ start, end }] }
}

/**
 * The window a layer would request, `[time.start, time.end]`, as epoch
 * milliseconds. Null when either bound is missing or unreadable. The
 * current instant is the window's end, not its middle — see
 * TimeControl.updateLayersTime.
 */
export function parseRequestedWindow(time) {
    if (time == null) return null
    if (time.start == null || time.end == null) return null
    const start = new Date(time.start).getTime()
    const end = new Date(time.end).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) return null
    return { start, end }
}

/** Whether any span touches the window. Inclusive at both edges. */
function spansOverlapWindow(spans, window) {
    return spans.some(
        (span) => span.start <= window.end && span.end >= window.start
    )
}

/**
 * The full coverage record for a layer: what it declares, what it would
 * request, and the verdict.
 *
 * `outOfDataRange` is false whenever the question cannot be answered — no
 * coverage declared, no readable window, no `time` at all. The gate may
 * only suppress on positive evidence of absence; a bug here must cost a
 * wasted request, never a missing layer.
 */
export function evaluateLayerDataCoverage(layer) {
    const coverage = resolveDataCoverage(layer?.time)
    const requestedWindow = parseRequestedWindow(layer?.time)

    const outOfDataRange =
        coverage != null &&
        requestedWindow != null &&
        !spansOverlapWindow(coverage.spans, requestedWindow)

    return {
        outOfDataRange,
        kind: coverage?.kind ?? null,
        spans: coverage?.spans ?? null,
        requestedWindow,
    }
}

/**
 * Whether the gate may take a layer off the map. A controlled layer is
 * driven by an external caller and moves only when that caller reloads it
 * with `evenIfControlled`. A dynamicExtent layer fetches through its own
 * extent subscription, which the gate does not reach, so hiding it would
 * cost visibility and save nothing. Either is still reported.
 */
export function isCoverageGated(layer, evenIfControlled) {
    if (layer?.variables?.dynamicExtent === true) return false
    return evenIfControlled === true || layer?.controlled !== true
}

const MINUTE_MS = 60 * 1000
const toMinute = (ms) => (Number.isFinite(ms) ? Math.floor(ms / MINUTE_MS) : ms)

/**
 * Whether two records say the same thing about a layer's coverage. The
 * requested window is not part of the comparison — it changes on every
 * time step — and span bounds are compared at minute granularity, so a
 * `dataEndTime: 'now'` layer does not read as changed on every tick. A
 * listed entry's timestamp and unit come straight from config and are
 * compared exactly: two times in one hour share their bounds, so only the
 * timestamp shows one moving.
 */
export function isSameCoverage(a, b) {
    if (a == null || b == null) return false
    if (a.outOfDataRange !== b.outOfDataRange) return false
    if (a.kind !== b.kind) return false
    if ((a.spans == null) !== (b.spans == null)) return false
    if (a.spans == null) return true
    if (a.spans.length !== b.spans.length) return false
    return a.spans.every((span, i) => {
        const other = b.spans[i]
        return (
            toMinute(span.start) === toMinute(other.start) &&
            toMinute(span.end) === toMinute(other.end) &&
            span.at === other.at &&
            span.unit === other.unit
        )
    })
}
