import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData } from '../../types'
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
    if (!nav || !interval) return []

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
    const anchor = nav.start
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
    const boundsStartMs = bounds.start.getTime()
    const boundsEndMs = bounds.end.getTime()
    const leftEdge = xScale(bounds.start)
    const rightEdge = xScale(bounds.end)

    return (
        <g className="layer-timeline">
            {/* Time range bars */}
            {layer.timeRanges.map((range, index) => {
                const fromMs = Math.max(range.start.getTime(), boundsStartMs)
                const toMs = Math.min(range.end.getTime(), boundsEndMs)
                // A span wholly outside the global window has nothing to draw.
                if (toMs < fromMs) return null

                const x1 = xScale(fromMs)
                const x2 = xScale(toMs)
                const width = Math.max(x2 - x1, MIN_BAR_WIDTH)
                // A bar widened to the minimum is centred on its span, so it
                // stays over its own time rather than trailing to the right,
                // and held inside the global window's edges.
                const centred = width > x2 - x1 ? (x1 + x2 - width) / 2 : x1
                const x = Math.max(
                    leftEdge,
                    Math.min(centred, rightEdge - width)
                )
                const clippedWidth = Math.min(width, rightEdge - x)

                // Each pinch narrows to fit between its neighbours, and one
                // too close to an end of the bar to fit is left out.
                const divisions = divisionXs(layer, xScale, fromMs, toMs)
                let spacing = Infinity
                for (let i = 1; i < divisions.length; i++)
                    spacing = Math.min(spacing, divisions[i] - divisions[i - 1])
                const half = Math.min(PINCH_HALF_WIDTH, spacing * 0.35)
                const pinched = divisions.filter(
                    (dx) => dx - half > x && dx + half < x + clippedWidth
                )

                return (
                    <React.Fragment key={index}>
                        <rect
                            x={x}
                            y={barY}
                            width={Math.max(0, clippedWidth)}
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
                                {range.label
                                    ? range.label
                                    : `${range.start.toISOString()} to ${range.end.toISOString()}`}
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
