import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData, TimeRange } from '../../types'
import type { ViewWindow } from '../../utils/zoomWindow'
import {
    addSteps,
    shortestStepMs,
    stepIndexAtOrBefore,
} from '../../utils/duration'

export interface LayerTimelineProps {
    layer: LayerTimeData
    xScale: ScaleTime<number, number>
    /**
     * The global window. Bars and their divisions are cut to it, so none is
     * drawn in the margin the chart shows past either end.
     */
    bounds: ViewWindow
    y: number
    height: number
}

// Drawn thickness of a range bar, independent of the row height that sidebar
// chrome also sets, so the chart stays as light as rows grow.
const BAR_THICKNESS = 9

// Narrowest a range bar is drawn, so a single instant or a period shorter
// than a few pixels at the current zoom still reads and can be hovered.
const MIN_BAR_WIDTH = 6

// The closest two divisions may sit, in pixels. Steps any tighter at the
// current zoom would run together into a smear, so the bar is drawn solid
// until zooming in spreads them this far apart.
const MIN_DIVISION_SPACING = 8

// How far each pinch cuts into the bar from above and below, leaving a waist
// of the bar's thickness less twice this.
const PINCH_DEPTH = 2

// Half the width of a pinch at the bar's edge, before it narrows to the
// spacing of the steps.
const PINCH_HALF_WIDTH = 3

/**
 * The bites that pinch a bar at each division: one curving down from its top
 * edge and one curving up from its bottom, meeting at a waist, so the bar
 * reads as segments pinched apart. Each bite starts at its tip, on the
 * division.
 */
function pinchPath(
    xs: number[],
    top: number,
    thickness: number,
    half: number
): string {
    const bottom = top + thickness
    const bite = (x: number, edge: number, tip: number) => {
        // Past the bar's edge by a pixel, so no sliver of the bar is left
        // along the curve's outer end.
        const outside = edge + Math.sign(edge - tip)
        return (
            `M${x},${tip}` +
            `C${x - half / 2},${tip} ${x - half / 2},${edge} ${x - half},${edge}` +
            `L${x - half},${outside}L${x + half},${outside}L${x + half},${edge}` +
            `C${x + half / 2},${edge} ${x + half / 2},${tip} ${x},${tip}Z`
        )
    }
    return xs
        .map(
            (x) =>
                bite(x, top, top + PINCH_DEPTH) +
                bite(x, bottom, bottom - PINCH_DEPTH)
        )
        .join('')
}

/**
 * The x of every step boundary strictly inside `[fromMs, toMs]` that falls on
 * the chart, or none when neighbouring steps would sit closer than
 * `MIN_DIVISION_SPACING`. Only the boundaries on screen are generated, so a
 * multi-year daily layer costs what fits across the chart, not a step a day.
 */
export function divisionXs(
    layer: LayerTimeData,
    xScale: ScaleTime<number, number>,
    fromMs: number,
    toMs: number
): number[] {
    const nav = layer.navigation
    const interval = nav?.interval
    const anchor = nav?.anchor
    if (!nav || !interval || !anchor) return []

    const [x0, x1] = xScale.range()
    const [d0, d1] = xScale.domain()
    const msPerPx = (d1.getTime() - d0.getTime()) / Math.max(1, x1 - x0)
    if (!(msPerPx > 0)) return []
    if (shortestStepMs(interval) / msPerPx < MIN_DIVISION_SPACING) return []

    // The chart's full width, margins included. Its margins are equal, so the
    // two ends of the scale's range sum to that width.
    const chartFrom = Math.max(fromMs, xScale.invert(0).getTime())
    const chartTo = Math.min(toMs, xScale.invert(x0 + x1).getTime())
    if (!(chartTo > chartFrom)) return []

    const xs: number[] = []
    let n = stepIndexAtOrBefore(anchor, interval, new Date(chartFrom))
    for (;;) {
        const at = addSteps(anchor, interval, n).getTime()
        // A step past the range a Date can hold is not a boundary on the chart.
        if (!Number.isFinite(at) || at >= chartTo) break
        if (at > fromMs) xs.push(xScale(at))
        n++
    }
    return xs
}

// Boxes closer than this, in pixels, are drawn as one. A gap narrower than a
// pixel does not read as a gap, and would only leave a notch between two
// boxes' rounded ends.
const JOIN_TOLERANCE = 1

/** A box on the chart, standing for one or more of a layer's spans. */
interface DrawnBar {
    x: number
    width: number
    fromMs: number
    toMs: number
    first: TimeRange
    // The span reaching furthest right, which names the box's end.
    last: TimeRange
}

/**
 * The boxes a layer's spans are drawn as. Spans whose boxes would overlap or
 * touch at the current zoom are drawn as one box, so a sparse layer listing
 * thousands of periods costs the boxes that can be told apart, not a box a
 * period, and no stacked pair reads darker than its neighbours through the
 * bars' shared opacity. A box wholly off the chart is not drawn.
 */
function drawnBars(
    ranges: TimeRange[],
    xScale: ScaleTime<number, number>,
    bounds: ViewWindow
): DrawnBar[] {
    const boundsStartMs = bounds.start.getTime()
    const boundsEndMs = bounds.end.getTime()
    const leftEdge = xScale(bounds.start)
    const rightEdge = xScale(bounds.end)
    // The chart's full width, margins included. Its margins are equal, so the
    // two ends of the scale's range sum to that width.
    const [r0, r1] = xScale.range()
    const chartWidth = r0 + r1

    const sorted = [...ranges].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
    )

    const bars: DrawnBar[] = []
    sorted.forEach((range) => {
        const fromMs = Math.max(range.start.getTime(), boundsStartMs)
        const toMs = Math.min(range.end.getTime(), boundsEndMs)
        // A span wholly outside the global window has nothing to draw.
        if (toMs < fromMs) return

        const x1 = xScale(fromMs)
        const x2 = xScale(toMs)
        const width = Math.max(x2 - x1, MIN_BAR_WIDTH)
        // A bar widened to the minimum is centred on its span, so it stays
        // over its own time rather than trailing to the right, and held
        // inside the global window's edges.
        const centred = width > x2 - x1 ? (x1 + x2 - width) / 2 : x1
        const x = Math.max(leftEdge, Math.min(centred, rightEdge - width))
        const clippedWidth = Math.max(0, Math.min(width, rightEdge - x))
        if (x + clippedWidth < 0 || x > chartWidth) return

        const prev = bars[bars.length - 1]
        if (prev && x <= prev.x + prev.width + JOIN_TOLERANCE) {
            const right = Math.max(prev.x + prev.width, x + clippedWidth)
            prev.width = right - prev.x
            if (toMs >= prev.toMs) {
                prev.toMs = toMs
                prev.last = range
            }
            return
        }
        bars.push({
            x,
            width: clippedWidth,
            fromMs,
            toMs,
            first: range,
            last: range,
        })
    })
    return bars
}

/** What a box's tooltip names it: its period, or the periods it runs across. */
function barLabel(bar: DrawnBar): string {
    if (bar.first === bar.last)
        return bar.first.label
            ? bar.first.label
            : `${bar.first.start.toISOString()} to ${bar.first.end.toISOString()}`
    const from = bar.first.label ?? bar.first.start.toISOString()
    const to = bar.last.label ?? bar.last.end.toISOString()
    return `${from} to ${to}`
}

/**
 * One layer's row of bars. Memoized, so a scrubber drag, which re-renders the
 * chart on every move, leaves the rows and their divisions alone.
 */
export const LayerTimeline: React.FC<LayerTimelineProps> = React.memo(({
    layer,
    xScale,
    bounds,
    y,
    height,
}) => {
    const barY = y + (height - BAR_THICKNESS) / 2

    return (
        <g className="layer-timeline">
            {drawnBars(layer.timeRanges, xScale, bounds).map((bar, index) => {
                const { x, width } = bar

                // Each pinch narrows to fit between its neighbours, and one
                // too close to an end of the bar to fit is left out.
                const divisions = divisionXs(layer, xScale, bar.fromMs, bar.toMs)
                let spacing = Infinity
                for (let i = 1; i < divisions.length; i++)
                    spacing = Math.min(spacing, divisions[i] - divisions[i - 1])
                const half = Math.min(PINCH_HALF_WIDTH, spacing * 0.35)
                const pinched = divisions.filter(
                    (dx) => dx - half > x && dx + half < x + width
                )

                return (
                    <React.Fragment key={index}>
                        <rect
                            x={x}
                            y={barY}
                            width={width}
                            height={BAR_THICKNESS}
                            /* Set as a style, not a fill attribute, so a var() colour resolves */
                            style={{ fill: layer.color }}
                            opacity={0.85}
                            rx={4}
                            className="layer-time-range"
                        >
                            <title>
                                {layer.displayName}
                                {'\n'}
                                {barLabel(bar)}
                            </title>
                        </rect>
                        {pinched.length > 0 && (
                            // One path for every division on screen, rather
                            // than an element each.
                            <path
                                d={pinchPath(pinched, barY, BAR_THICKNESS, half)}
                                className="layer-time-divisions"
                                aria-hidden="true"
                            />
                        )}
                    </React.Fragment>
                )
            })}
        </g>
    )
})
