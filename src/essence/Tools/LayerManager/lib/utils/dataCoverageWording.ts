import type { CoverageSpan, CoverageUnit, DataCoverage } from '../types'

/**
 * A layer's coverage record in words, for the popover on a row whose layer
 * has no data at the time being asked for. Pure: record in, three lines out.
 *
 * Everything is UTC and in English whatever the browser's locale, so the
 * words match the timeline and the layer config they were read from.
 */

export type DataCoverageWording = {
    title: string
    /** The instant being asked for; null when the record carries no window. */
    instant: string | null
    /** What the layer holds; null when it names no bound to describe. */
    coverage: string | null
}

const TITLE = 'No data at this time'

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (value: number, width = 2): string =>
    String(value).padStart(width, '0')

const yearOf = (ms: number): string => pad(new Date(ms).getUTCFullYear(), 4)

const monthOf = (ms: number): string => {
    const date = new Date(ms)
    return `${MONTHS[date.getUTCMonth()]} ${yearOf(ms)}`
}

const dayOf = (ms: number): string => {
    const date = new Date(ms)
    return `${yearOf(ms)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** HH:mm, with seconds only when there are some to show. */
const clockOf = (ms: number): string => {
    const date = new Date(ms)
    const seconds = date.getUTCSeconds()
    return (
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` +
        (seconds ? `:${pad(seconds)}` : '')
    )
}

const isMidnight = (ms: number): boolean => ((ms % DAY_MS) + DAY_MS) % DAY_MS === 0

/** A moment, by day alone when it falls at midnight. */
const instantOf = (ms: number): string =>
    isMidnight(ms) ? dayOf(ms) : `${dayOf(ms)} ${clockOf(ms)} UTC`

/**
 * One bound of an extent. An end closes the unit it names, so it sits on the
 * last millisecond of it: one that closes a day is named by that day, and any
 * other by the minute it falls in.
 */
const boundOf = (ms: number, edge: 'start' | 'end'): string => {
    const onDayBoundary = edge === 'start' ? isMidnight(ms) : isMidnight(ms + 1)
    if (onDayBoundary) return dayOf(ms)
    const date = new Date(ms)
    return `${dayOf(ms)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/** A listed entry's timestamp, named at the unit the entry names. */
const entryName = (at: number, unit: CoverageUnit | undefined): string => {
    switch (unit) {
        case 'year':
            return yearOf(at)
        case 'month':
            return monthOf(at)
        case 'day':
            return dayOf(at)
        case 'hour':
            return `${dayOf(at)} ${clockOf(at)} UTC`
        default:
            return boundOf(at, 'start')
    }
}

/** A lone listed entry as a phrase: "in 2020", "on 2020-03-04 at 14:30 UTC". */
const entryPhrase = (at: number, unit: CoverageUnit | undefined): string => {
    switch (unit) {
        case 'year':
        case 'month':
            return `in ${entryName(at, unit)}`
        case 'hour':
            return `on ${dayOf(at)} at ${clockOf(at)} UTC`
        default:
            return `on ${entryName(at, unit)}`
    }
}

/** The furthest from the epoch a Date reaches; past it there is no day to name. */
const MAX_DATE_MS = 8.64e15

/** A timestamp that names a moment. */
const isMoment = (value: unknown): value is number =>
    typeof value === 'number' && Math.abs(value) <= MAX_DATE_MS

/** An extent bound: a moment, or Infinity / -Infinity when it is open. */
const isBound = (value: unknown): value is number =>
    isMoment(value) || value === Infinity || value === -Infinity

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null

/** A listed entry that can be named, its timestamp and bounds all moments. */
type NamedEntry = { at: number; start: number; end: number; unit?: CoverageUnit }

/**
 * The listed entries there is a timestamp to name, in the order given. An
 * entry without an `at` is named by its start. One whose `at`, or whose start
 * in its absence, is not a moment is left out, as is anything that is not an
 * entry at all.
 */
const namedEntries = (spans: unknown[]): NamedEntry[] =>
    spans.flatMap((span) => {
        if (!isObject(span)) return []
        const { at, start, end, unit } = span as Partial<CoverageSpan>
        const timestamp = at ?? start
        if (!isMoment(timestamp)) return []
        return [
            {
                at: timestamp,
                start: isMoment(start) ? start : timestamp,
                end: isMoment(end) ? end : timestamp,
                unit,
            },
        ]
    })

/** The entry `order` puts first, the earlier listed on a tie. */
const firstBy = (
    entries: NamedEntry[],
    order: (a: NamedEntry, b: NamedEntry) => number,
): NamedEntry => entries.reduce((best, entry) => (order(entry, best) < 0 ? entry : best))

// Where the range opens: the earliest start, and of the entries sharing it
// the narrowest, which names that start most exactly.
const byOpening = (a: NamedEntry, b: NamedEntry): number =>
    a.start - b.start || a.end - b.end || a.at - b.at

// Where the range closes: the latest end — not the latest start, since an
// entry can hold later ones inside it — and the narrowest of those sharing it.
const byClosing = (a: NamedEntry, b: NamedEntry): number =>
    b.end - a.end || b.start - a.start || b.at - a.at

const describeContinuous = (start: number, end: number): string | null => {
    const hasStart = Number.isFinite(start)
    const hasEnd = Number.isFinite(end)
    if (hasStart && hasEnd) {
        return `Data available ${boundOf(start, 'start')} to ${boundOf(end, 'end')}`
    }
    if (hasEnd) return `Data available until ${boundOf(end, 'end')}`
    if (hasStart) return `Data available from ${boundOf(start, 'start')}`
    return null
}

const describeSparse = (entries: NamedEntry[]): string => {
    const first = firstBy(entries, byOpening)
    const last = firstBy(entries, byClosing)
    if (entries.length === 1) {
        return `Data available ${entryPhrase(first.at, first.unit)}`
    }
    // One entry holds all the others, so it is the whole range.
    if (first === last) {
        return `Data available for ${entries.length} listed periods ${entryPhrase(first.at, first.unit)}`
    }
    return (
        `Data available for ${entries.length} listed periods, ` +
        `${entryName(first.at, first.unit)} to ${entryName(last.at, last.unit)}`
    )
}

const describeInstant = (requestedWindow: unknown): string | null => {
    const end = isObject(requestedWindow) ? requestedWindow.end : undefined
    return isMoment(end) ? `Requested ${instantOf(end)}` : null
}

/**
 * Null for a record with nothing to word: none at all, a layer that declares
 * no coverage, a sparse layer listing nothing that can be named, or an extent
 * with a bound that cannot be read. The panel words a record on every render,
 * so a malformed one costs only its own words and never throws.
 */
export const describeDataCoverage = (
    record: DataCoverage | null | undefined,
): DataCoverageWording | null => {
    if (!isObject(record)) return null
    const { kind, spans } = record
    if (!Array.isArray(spans)) return null

    let coverage: string | null
    if (kind === 'sparse') {
        const entries = namedEntries(spans)
        if (entries.length === 0) return null
        coverage = describeSparse(entries)
    } else if (kind === 'continuous') {
        const [extent] = spans as unknown[]
        if (!isObject(extent) || !isBound(extent.start) || !isBound(extent.end)) {
            return null
        }
        coverage = describeContinuous(extent.start, extent.end)
    } else {
        return null
    }

    return {
        title: TITLE,
        instant: describeInstant(record.requestedWindow),
        coverage,
    }
}
