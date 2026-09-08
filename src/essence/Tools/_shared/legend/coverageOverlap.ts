/**
 * What part of a layer's coverage a request could have returned.
 *
 * The map asks a server for a span — the slider's window start to its cursor
 * — and the layer says, through its Data Time Extent, where its data exists
 * at all. Only where the two meet can the pixels on screen be from, whatever
 * scene the server picked inside it. Pure arithmetic on ISO instants: an
 * absent bound is unbounded rather than zero, and a bound that will not parse
 * is no bound at all, so it can never narrow a range it says nothing about.
 */

/** A layer's coverage. Either end may be absent: the data reaches past it. */
export type Coverage = { start: string | null; end: string | null }

/** The span the map requested. Its start is absent in the slider's Point
 *  mode, where nothing says how far back the request reached. */
export type RequestSpan = { start: string | null; end: string }

/** The covered part of a request. Its start is absent only when neither the
 *  request nor the coverage bounds the past. */
export type Overlap = { start: string | null; end: string }

/** An instant that parsed, carried with the text it was written as, so a
 *  range prints the dates it was given rather than a rewritten form. */
type Bound = { text: string; ms: number } | null

const bound = (instant: string | null | undefined): Bound => {
    if (typeof instant !== 'string') return null
    const ms = Date.parse(instant)
    return Number.isNaN(ms) ? null : { text: instant, ms }
}

// Null is unbounded on both helpers: the other bound is then the only one
// there is.
const later = (a: Bound, b: Bound): Bound =>
    a === null ? b : b === null ? a : a.ms >= b.ms ? a : b

const earlier = (a: Bound, b: Bound): Bound =>
    a === null ? b : b === null ? a : a.ms <= b.ms ? a : b

/**
 * The overlap of `request` and `coverage`, or null when they do not meet —
 * a cursor sitting before the layer's first scene, say, where the server had
 * nothing inside the span to draw. Null too without a readable cursor, since
 * there is then no request to intersect.
 */
export const coverageOverlap = (
    request: RequestSpan,
    coverage: Coverage,
): Overlap | null => {
    const cursor = bound(request.end)
    if (cursor === null) return null
    const start = later(bound(request.start), bound(coverage.start))
    const end = earlier(cursor, bound(coverage.end))
    if (end === null) return null
    if (start !== null && start.ms > end.ms) return null
    return { start: start?.text ?? null, end: end.text }
}

/**
 * Whether any of `coverage` falls inside `period` — the test for whether the
 * period holding the cursor is a range the data can be from. A period runs up
 * to but not including its end, so one ending on the coverage's first instant
 * holds none of it.
 */
export const hasDataIn = (
    coverage: Coverage,
    period: { start: string; end: string },
): boolean => {
    const start = bound(period.start)
    const end = bound(period.end)
    if (start === null || end === null) return false
    const coverageStart = bound(coverage.start)
    const coverageEnd = bound(coverage.end)
    if (coverageEnd !== null && start.ms > coverageEnd.ms) return false
    if (coverageStart !== null && end.ms <= coverageStart.ms) return false
    return true
}

/**
 * `period` narrowed to the part of it the coverage fills. A period is a shape
 * the cadence imposes, not a promise of data: the layer's coverage can begin
 * partway into it or stop partway through, and printing the raw period would
 * then name days the layer has nothing for. Either end that the coverage does
 * not reach is replaced by the coverage's own bound. The request span is
 * deliberately not clipped to: a monthly composite is the whole month even
 * when the window opened mid-month.
 *
 * `endIsPeriodEnd` says which the end came from, because the two print
 * differently — a period's end is the next period's start and prints
 * inclusively, while a coverage end is an instant the data reaches and prints
 * as it is.
 */
export const clipPeriodToCoverage = (
    period: { start: string; end: string },
    coverage: Coverage,
): { start: string; end: string; endIsPeriodEnd: boolean } => {
    const periodStart = bound(period.start)
    const coverageStart = bound(coverage.start)
    const start =
        periodStart !== null &&
        coverageStart !== null &&
        coverageStart.ms > periodStart.ms
            ? coverageStart.text
            : period.start
    const periodEnd = bound(period.end)
    const coverageEnd = bound(coverage.end)
    return periodEnd !== null &&
        coverageEnd !== null &&
        coverageEnd.ms < periodEnd.ms
        ? { start, end: coverageEnd.text, endIsPeriodEnd: false }
        : { start, end: period.end, endIsPeriodEnd: true }
}
