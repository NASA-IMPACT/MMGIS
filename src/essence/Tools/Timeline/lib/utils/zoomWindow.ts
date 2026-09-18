import { zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { TimeMode } from '../types'

/**
 * A span of time on screen. The timeline holds two of these: the global window
 * it shares with core, which bounds where the scrubber can go, and the visible
 * window, which is the Timeline's alone.
 */
export interface ViewWindow {
    start: Date
    end: Date
}

const MS_MINUTE = 60000
const MS_HOUR = 60 * MS_MINUTE
const MS_DAY = 24 * MS_HOUR

/**
 * A window of whole milliseconds from a fractional start and span. The start
 * is rounded once and the rounded span added to it, so the span survives
 * exactly: rounding the two endpoints on their own can leave them a
 * millisecond apart from the span they were meant to enclose.
 */
const windowOf = (start: number, span: number): ViewWindow => {
    const from = Math.round(start)
    return { start: new Date(from), end: new Date(from + Math.round(span)) }
}

/**
 * How far in the view may go, by the granularity the dashboard is configured
 * to display. Each floor leaves enough tick marks for the axis to read as an
 * axis rather than as a pair of endpoints: 24 hourly, 3 daily, 2 monthly,
 * 2 yearly.
 *
 * The floor follows the granularity rather than being a constant, because one
 * multi-day floor would make an hourly dashboard useless — and sub-day
 * inspection is the whole reason HOUR exists.
 */
export function minViewDuration(granularity: TimeMode): number {
    switch (granularity) {
        case 'HOUR':
            return 24 * MS_HOUR
        case 'DAY':
            return 3 * MS_DAY
        case 'MONTH':
            return 62 * MS_DAY
        case 'YEAR':
            return 730 * MS_DAY
    }
}

/**
 * A window brought into range, enforcing in order: the span is at least
 * `minMs`; the span is at most the bounds' span; the window lies inside the
 * bounds.
 *
 * The order carries weight. Widening a below-floor window before sliding it
 * inside the bounds leaves a result that is both wide enough and in range,
 * where the reverse order can push a just-clamped window back out. A span
 * that changes is grown or shrunk about the window's own centre; a span that
 * does not change keeps its start untouched, so a window already in range
 * comes back bit-for-bit and the view can be compared by value.
 *
 * Both windows are expected to hold valid Dates. A NaN timestamp is not caught
 * here and passes straight through into two Invalid Dates, so a caller that
 * takes times from configuration validates them before they arrive.
 */
export function clampWindow(
    win: ViewWindow,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const boundsStart = bounds.start.getTime()
    const boundsEnd = bounds.end.getTime()
    const boundsSpan = Math.max(0, boundsEnd - boundsStart)

    let start = win.start.getTime()
    let end = win.end.getTime()
    // A reversed window is reachable: a layer configured with dataStartTime
    // after dataEndTime — the case layerNavigation warns about — reaches
    // fitWindow inverted, and the swap turns it into a forward window of the
    // same span.
    if (end < start) {
        const swap = start
        start = end
        end = swap
    }

    const requested = end - start
    const span = Math.min(Math.max(requested, minMs), boundsSpan)

    if (span !== requested) {
        start = Math.round(start + requested / 2 - span / 2)
    }

    if (start < boundsStart) start = boundsStart
    if (start + span > boundsEnd) start = boundsEnd - span

    return { start: new Date(start), end: new Date(start + span) }
}

/**
 * The window scaled by `factor` about `anchor`, which holds the same
 * fractional position across the window before and after — so the instant
 * under the pointer, or under the scrubber, stays where it is.
 *
 * The anchor is expected to lie inside the window; callers that cannot
 * guarantee that pass the window's centre instead. Clamping can move the
 * result, and with it the anchor, when the zoom runs into a bound.
 */
export function zoomAround(
    win: ViewWindow,
    factor: number,
    anchor: Date,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const start = win.start.getTime()
    const span = win.end.getTime() - start
    const at = anchor.getTime()
    const fraction = span > 0 ? (at - start) / span : 0.5

    const nextSpan = span * factor
    const nextStart = at - fraction * nextSpan

    return clampWindow(windowOf(nextStart, nextSpan), bounds, minMs)
}

/**
 * The floor as a fraction of the bounds' span — the base of the slider's
 * logarithm — or null when the slider has no travel. A bounds span at or below
 * the floor puts the ratio at or above one, where the logarithm is degenerate
 * or undefined, and only one position is reachable.
 */
const sliderRatio = (bounds: ViewWindow, minMs: number): number | null => {
    const fullSpan = bounds.end.getTime() - bounds.start.getTime()
    if (!(fullSpan > 0)) return null
    const ratio = minMs / fullSpan
    return ratio < 1 ? ratio : null
}

/**
 * Where a window sits on the slider, from 0 (the full global window) to 1
 * (the floor).
 *
 * The mapping is logarithmic. Spans run from days to years, so a linear
 * mapping from position to duration would crowd every useful zoom level into
 * the last few percent of travel.
 */
export function windowToSlider(
    win: ViewWindow,
    bounds: ViewWindow,
    minMs: number
): number {
    const ratio = sliderRatio(bounds, minMs)
    if (ratio === null) return 0

    const fullSpan = bounds.end.getTime() - bounds.start.getTime()
    const span = win.end.getTime() - win.start.getTime()
    if (!(span > 0)) return 1

    const v = Math.log(span / fullSpan) / Math.log(ratio)
    return Math.min(1, Math.max(0, v))
}

/**
 * The window a slider position names, centred on `anchor`.
 *
 * The inverse of `windowToSlider`: `duration(v) = fullSpan · ratio ^ v`, where
 * `ratio` is the floor over the full span.
 */
export function sliderToWindow(
    v: number,
    anchor: Date,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const ratio = sliderRatio(bounds, minMs)
    if (ratio === null) return { start: bounds.start, end: bounds.end }

    const fullSpan = bounds.end.getTime() - bounds.start.getTime()
    const position = Math.min(1, Math.max(0, v))
    const span = fullSpan * Math.pow(ratio, position)
    const start = anchor.getTime() - span / 2

    return clampWindow(windowOf(start, span), bounds, minMs)
}

/**
 * The window framing every extent given, padded by `padFraction` of the
 * union's span on each side so bars do not butt against the chart's edges.
 *
 * Null for an empty list, which is how callers tell "nothing to fit" from
 * "fit to everything".
 */
export function fitWindow(
    extents: ViewWindow[],
    bounds: ViewWindow,
    minMs: number,
    padFraction: number
): ViewWindow | null {
    if (extents.length === 0) return null

    let start = Infinity
    let end = -Infinity
    for (const extent of extents) {
        start = Math.min(start, extent.start.getTime())
        end = Math.max(end, extent.end.getTime())
    }

    const pad = (end - start) * padFraction

    return clampWindow(
        windowOf(start - pad, end - start + 2 * pad),
        bounds,
        minMs
    )
}

/**
 * The d3 zoom transform that maps the global window onto the visible one,
 * across a chart `width` pixels wide. The visible window is the source of
 * truth; this is how d3's own internal state is kept in step with it.
 */
export function windowToTransform(
    win: ViewWindow,
    bounds: ViewWindow,
    width: number
): ZoomTransform {
    const boundsStart = bounds.start.getTime()
    const boundsSpan = bounds.end.getTime() - boundsStart
    const viewStart = win.start.getTime()
    const viewSpan = win.end.getTime() - viewStart

    if (!(boundsSpan > 0) || !(viewSpan > 0) || !(width > 0)) return zoomIdentity

    const k = boundsSpan / viewSpan
    const x = -width * ((viewStart - boundsStart) / viewSpan)

    return zoomIdentity.translate(x, 0).scale(k)
}

/** The visible window a d3 zoom transform names. The inverse of `windowToTransform`. */
export function transformToWindow(
    t: ZoomTransform,
    bounds: ViewWindow,
    width: number
): ViewWindow {
    const boundsStart = bounds.start.getTime()
    const boundsSpan = bounds.end.getTime() - boundsStart

    if (!(boundsSpan > 0) || !(width > 0))
        return { start: bounds.start, end: bounds.end }

    const at = (px: number) =>
        boundsStart + (t.invertX(px) / width) * boundsSpan

    return {
        start: new Date(Math.round(at(0))),
        end: new Date(Math.round(at(width))),
    }
}

const SPAN_UNITS: [number, string][] = [
    [365 * MS_DAY, 'year'],
    [30 * MS_DAY, 'month'],
    [MS_DAY, 'day'],
    [MS_HOUR, 'hour'],
    [MS_MINUTE, 'minute'],
]

/**
 * A duration in words, for the slider's `aria-valuetext`. The raw 0–1 position
 * means nothing spoken aloud; the span it stands for does.
 */
export function describeSpan(ms: number): string {
    for (const [size, name] of SPAN_UNITS) {
        if (ms >= size) {
            const count = Math.round(ms / size)
            return `${count} ${name}${count === 1 ? '' : 's'}`
        }
    }
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `${seconds} second${seconds === 1 ? '' : 's'}`
}
