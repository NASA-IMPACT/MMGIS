/**
 * What part of a layer's coverage a request could have returned.
 *
 * The map asks a server for a span — the one core stamped on the layer — and
 * the layer says, through its Data Time Extent, where its data exists at
 * all. Only where the two meet can the pixels on screen be from, whatever
 * scene the server picked inside it. Pure arithmetic on ISO instants: an
 * absent bound is unbounded rather than zero, and a bound that will not parse
 * is no bound at all, so it can never narrow a range it says nothing about.
 */

import { parseInstant, type Instant } from './isoInstant'

/** A layer's coverage. Either end may be absent: the data reaches past it. */
export type Coverage = { start: string | null; end: string | null }

/** The span the map requested. Its start is absent in the Time Control's
 *  Point mode for a layer requesting the window rather than one period,
 *  where nothing says how far back the request reached. */
export type RequestSpan = { start: string | null; end: string }

/** The covered part of a request. Its start is absent only when neither the
 *  request nor the coverage bounds the past. */
export type Overlap = { start: string | null; end: string }

/** A bound that parsed, or null: a bound nobody set, and one that will not
 *  parse, both narrow nothing. */
type Bound = Instant | null

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
    const cursor = parseInstant(request.end)
    if (cursor === null) return null
    const start = later(
        parseInstant(request.start),
        parseInstant(coverage.start),
    )
    const end = earlier(cursor, parseInstant(coverage.end))
    if (end === null) return null
    if (start !== null && start.ms > end.ms) return null
    return { start: start?.text ?? null, end: end.text }
}
