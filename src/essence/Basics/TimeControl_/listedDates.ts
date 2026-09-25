import moment from 'moment'

/**
 * A layer's listed data dates (`time.dataDates`), read as spans.
 *
 * Shared by the coverage reader, which gates a layer on its listed entries,
 * and the time-policy reader, which requests no period for a layer that
 * lists any. Both read the list the same way, so an entry one of them
 * ignores the other ignores too.
 *
 * Epoch milliseconds throughout.
 */

export type ListedUnit = 'year' | 'month' | 'day' | 'hour'

export interface ListedEntry {
    start: number
    end: number
    at: number
    unit: ListedUnit
}

/**
 * The unit an ISO 8601 entry names, read from the format the parser matched
 * it against. Anything finer than the hour is the hour: an hour is the
 * finest step the timeline takes.
 */
export function unitOf(format: string): ListedUnit {
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
export function readEntry(raw: unknown): ListedEntry | null {
    const time = moment.utc(String(raw).trim(), moment.ISO_8601, true)
    if (!time.isValid()) return null
    const unit = unitOf(String(time.creationData().format))
    if (unit == null) return null
    return {
        start: time.clone().startOf(unit).valueOf(),
        end: time.clone().endOf(unit).valueOf(),
        at: time.valueOf(),
        unit,
    }
}

// `dataDates` as a list: a single bare string is a list of one, anything
// else lists nothing.
function listOf(dataDates: unknown): unknown[] {
    if (Array.isArray(dataDates)) return dataDates
    if (typeof dataDates === 'string') return [dataDates]
    return []
}

/**
 * Whether `dataDates` holds at least one entry `resolveListedEntries` would
 * keep, reading no further than the first readable entry.
 */
export function hasListedEntries(dataDates: unknown): boolean {
    return listOf(dataDates).some((raw) => readEntry(raw) != null)
}

/**
 * The entries a layer lists data at, one span per entry, ordered by where
 * each starts and then by its timestamp. An entry listed twice is kept once;
 * entries that overlap or nest are all kept, since each is its own place to
 * move the timeline to. `dataDates` is accepted as a list or as a single
 * bare string, and an unreadable entry costs only itself.
 */
export function resolveListedEntries(dataDates: unknown): ListedEntry[] {
    const listed = listOf(dataDates)
    const byKey = new Map<string, ListedEntry>()
    listed.forEach((raw) => {
        const entry = readEntry(raw)
        if (entry) byKey.set(`${entry.unit}|${entry.at}`, entry)
    })

    return [...byKey.values()].sort(
        (a, b) => a.start - b.start || a.at - b.at || a.end - b.end
    )
}
