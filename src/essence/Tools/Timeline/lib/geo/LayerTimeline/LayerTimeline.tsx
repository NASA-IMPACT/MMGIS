import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData } from '../../types'

export interface LayerTimelineProps {
    layer: LayerTimeData
    xScale: ScaleTime<number, number>
    y: number
    height: number
}

export const LayerTimeline: React.FC<LayerTimelineProps> = ({
    layer,
    xScale,
    y,
    height,
}) => {
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
                        y={y + 4}
                        width={width}
                        height={height - 6}
                        fill={layer.color}
                        opacity={0.85}
                        rx={4}
                        className="layer-time-range"
                    >
                        <title>
                            {layer.displayName}
                            {'\n'}
                            {range.start.toISOString()} to {range.end.toISOString()}
                        </title>
                    </rect>
                )
            })}
        </g>
    )
}
