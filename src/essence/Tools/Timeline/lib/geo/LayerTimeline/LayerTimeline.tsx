import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData } from '../../types'

export interface LayerTimelineProps {
    layer: LayerTimeData
    xScale: ScaleTime<number, number>
    y: number
    height: number
}

// Drawn thickness of a range bar, independent of the row height that sidebar
// chrome also sets, so the chart stays as light as rows grow.
const BAR_THICKNESS = 9

// Narrowest a range bar is drawn, so a single instant or a period shorter
// than a few pixels at the current zoom still reads and can be hovered.
const MIN_BAR_WIDTH = 6

export const LayerTimeline: React.FC<LayerTimelineProps> = ({
    layer,
    xScale,
    y,
    height,
}) => {
    const barY = y + (height - BAR_THICKNESS) / 2

    return (
        <g className="layer-timeline">
            {/* Time range bars */}
            {layer.timeRanges.map((range, index) => {
                const x1 = xScale(range.start)
                const x2 = xScale(range.end)
                const width = Math.max(x2 - x1, MIN_BAR_WIDTH)
                // A bar widened to the minimum is centred on its span, so it
                // stays over its own time rather than trailing to the right.
                const x = width > x2 - x1 ? (x1 + x2 - width) / 2 : x1

                return (
                    <rect
                        key={index}
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
                            {range.label
                                ? range.label
                                : `${range.start.toISOString()} to ${range.end.toISOString()}`}
                        </title>
                    </rect>
                )
            })}
        </g>
    )
}
