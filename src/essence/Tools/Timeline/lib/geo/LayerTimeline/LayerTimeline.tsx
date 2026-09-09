import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData } from '../../types'

export interface LayerTimelineProps {
    layer: LayerTimeData
    xScale: ScaleTime<number, number>
    y: number
    height: number
}

// The drawn thickness of a range bar. It's independent of the row's height
// (which sidebar buttons and other chrome also share) so the chart doesn't
// get visually heavier as rows grow to fit more controls.
const BAR_THICKNESS = 9

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
                const width = Math.max(x2 - x1, 2) // Minimum 2px width

                return (
                    <rect
                        key={index}
                        x={x1}
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
