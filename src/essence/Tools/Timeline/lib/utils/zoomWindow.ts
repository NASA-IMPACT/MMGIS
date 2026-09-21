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
 * Whether two windows name the same span, to the millisecond. Windows are
 * compared by value throughout: the same span is routinely rebuilt as a fresh
 * object, by a parent's render or by a transform round-tripped through d3.
 */
export const sameWindow = (a: ViewWindow, b: ViewWindow): boolean =>
    a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime()

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
 * The window resized to `span` about `anchor`, which holds the same
 * fractional position across the window before and after — so the instant
 * under the scrubber stays where it is on screen and the view tightens or
 * opens around it. Every control that names a target span goes through here,
 * so the buttons and the slider place the view by one rule.
 *
 * The span is brought into `[minMs, bounds]` before the window is placed,
 * not after. Placing first and clamping second would hand `clampWindow` a
 * below-floor window, and it widens such a window about its own centre,
 * which walks the anchor towards the middle of the view on every press once
 * the floor is reached. With the span settled first, a press at the floor
 * asks for the span the view already has and leaves it exactly where it is.
 *
 * The anchor is expected to lie inside the window; callers that cannot
 * guarantee that pass the window's centre instead. Sliding into range can
 * still move the result, and with it the anchor, when a wider span runs into
 * a bound: the anchor then keeps the fraction nearest the one it had.
 */
export function windowAtSpan(
    win: ViewWindow,
    span: number,
    anchor: Date,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const start = win.start.getTime()
    const held = win.end.getTime() - start
    const at = anchor.getTime()
    const fraction = held > 0 ? (at - start) / held : 0.5

    const boundsSpan = Math.max(
        0,
        bounds.end.getTime() - bounds.start.getTime()
    )
    const nextSpan = Math.min(Math.max(span, minMs), boundsSpan)
    const nextStart = at - fraction * nextSpan

    return clampWindow(windowOf(nextStart, nextSpan), bounds, minMs)
}

/**
 * The window scaled by `factor` about `anchor`. The `±` buttons use factors
 * of 0.5 and 2.
 */
export function zoomAround(
    win: ViewWindow,
    factor: number,
    anchor: Date,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const span = win.end.getTime() - win.start.getTime()
    return windowAtSpan(win, span * factor, anchor, bounds, minMs)
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
 * The window a slider position names, placed about `anchor` as it sits in
 * `win`, the window on screen when the slider moved.
 *
 * The inverse of `windowToSlider`: `duration(v) = fullSpan · ratio ^ v`, where
 * `ratio` is the floor over the full span. The slider names only a span; where
 * that span sits is `windowAtSpan`'s rule, the same one the buttons follow.
 */
export function sliderToWindow(
    v: number,
    win: ViewWindow,
    anchor: Date,
    bounds: ViewWindow,
    minMs: number
): ViewWindow {
    const ratio = sliderRatio(bounds, minMs)
    if (ratio === null) return { start: bounds.start, end: bounds.end }

    const fullSpan = bounds.end.getTime() - bounds.start.getTime()
    const position = Math.min(1, Math.max(0, v))
    const span = fullSpan * Math.pow(ratio, position)

    return windowAtSpan(win, span, anchor, bounds, minMs)
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
 * Van Wijk and Nuij's smoothness parameter, the value d3's `interpolateZoom`
 * uses: it trades the length of the path against how far it zooms out to
 * travel.
 */
const RHO = Math.SQRT2
const RHO2 = RHO * RHO
const RHO4 = RHO2 * RHO2

/**
 * Below this fraction of the wider span, a shift of the centre is treated as
 * none at all: it is under a pixel on any chart narrower than a million
 * pixels, and a path that is a pure zoom is what the shift rounds to.
 */
const PURE_ZOOM_SHIFT = 1e-6

/**
 * The path from one window to another, as a function of progress `t` in
 * [0, 1]: `from` at 0 and `to` at 1, exactly, with the span changing
 * geometrically in between.
 *
 * Geometric, not linear, for the reason the slider is logarithmic: a linear
 * span visibly decelerates as it tightens, since each equal step is a larger
 * fraction of what remains. A pure zoom about a fixed centre therefore passes
 * through the geometric mean of the two spans at `t = 0.5`, not the
 * arithmetic mean.
 *
 * The path is Van Wijk and Nuij's ("Smooth and efficient zooming and panning",
 * 2003), the one behind d3's `interpolateZoom`, in one dimension: a change of
 * centre that is long relative to the spans zooms out first, so the content
 * between the two windows crosses the chart at a readable rate, and zooms
 * back in on arrival. d3's implementation is not used directly because it
 * evaluates `log(sqrt(b² + 1) − b)`, which cancels catastrophically once `b`
 * passes about 1e8, putting −Infinity into every frame. `b` grows as the
 * spans over the centre shift, so the exposed band is a shift just wide
 * enough to clear `PURE_ZOOM_SHIFT` and no wider: fitting a view at the
 * hourly floor out to a four-year window reaches it at a shift between
 * roughly two and eight minutes. The ratio is scale-invariant, so no change
 * of units mends it. That expression is `−asinh(b)`, which `Math.asinh`
 * evaluates stably at any magnitude.
 *
 * Given an `anchor`, the path pivots on it instead: the span still changes
 * geometrically, but each frame is placed so the anchor keeps the fraction of
 * the view it started with, travelling to the fraction it ends with only when
 * a bound moved it. Every zoom about the scrubber passes one, because Van
 * Wijk's path holds the endpoints alone — it reads an off-centre zoom as a
 * zoom plus a shift of the centre, and spends that shift on a trajectory of
 * its own, which walks the anchor off its pixel mid-flight and brings it back
 * by the last frame. A fit passes none: its travel is real, and the
 * zoom-out-to-cross is what makes it readable.
 *
 * A span the path passes through can exceed both endpoints' spans and, with
 * it, the bounds; callers clamp each frame as they would any window. A window
 * without a span has no geometric path, and is interpolated linearly.
 */
export function interpolateWindow(
    from: ViewWindow,
    to: ViewWindow,
    anchor?: Date
): (t: number) => ViewWindow {
    const start0 = from.start.getTime()
    const start1 = to.start.getTime()
    const w0 = from.end.getTime() - start0
    const w1 = to.end.getTime() - start1

    let at: (t: number) => ViewWindow

    if (!(w0 > 0) || !(w1 > 0)) {
        at = (t) => windowOf(start0 + t * (start1 - start0), w0 + t * (w1 - w0))
    } else if (anchor) {
        const at0 = anchor.getTime()
        const fraction0 = (at0 - start0) / w0
        const fraction1 = (at0 - start1) / w1
        const growth = Math.log(w1 / w0)
        at = (t) => {
            const span = w0 * Math.exp(t * growth)
            const fraction = fraction0 + t * (fraction1 - fraction0)
            return windowOf(at0 - fraction * span, span)
        }
    } else {
        const centre0 = start0 + w0 / 2
        const dx = start1 + w1 / 2 - centre0
        const d = Math.abs(dx)

        if (d <= PURE_ZOOM_SHIFT * Math.max(w0, w1)) {
            const growth = Math.log(w1 / w0)
            at = (t) => {
                const span = w0 * Math.exp(t * growth)
                return windowOf(centre0 + t * dx - span / 2, span)
            }
        } else {
            const b0 = (w1 * w1 - w0 * w0 + RHO4 * d * d) / (2 * w0 * RHO2 * d)
            const b1 = (w1 * w1 - w0 * w0 - RHO4 * d * d) / (2 * w1 * RHO2 * d)
            const r0 = -Math.asinh(b0)
            const r1 = -Math.asinh(b1)
            const S = (r1 - r0) / RHO
            const coshr0 = Math.cosh(r0)
            const sinhr0 = Math.sinh(r0)
            at = (t) => {
                const x = RHO * t * S + r0
                const travelled =
                    (w0 / (RHO2 * d)) * (coshr0 * Math.tanh(x) - sinhr0)
                const span = (w0 * coshr0) / Math.cosh(x)
                return windowOf(centre0 + travelled * dx - span / 2, span)
            }
        }
    }

    return (t) => {
        if (t <= 0) return from
        if (t >= 1) return to
        return at(t)
    }
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
