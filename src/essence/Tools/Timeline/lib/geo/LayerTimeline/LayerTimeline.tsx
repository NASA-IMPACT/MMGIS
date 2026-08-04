import React from 'react'
import type { ScaleTime } from 'd3-scale'
import type { LayerTimeData } from '../../types'

export interface LayerTimelineProps {
    layer: LayerTimeData
    xScale: ScaleTime<number, number>
    y: number
    height: number
}

/**
 * Placeholder for a single layer's row of time-range bars. Renders an empty
 * group; the bars arrive with the timeline view PR of this stack.
 */
export const LayerTimeline: React.FC<LayerTimelineProps> = () => {
    return <g className="layer-timeline" />
}
