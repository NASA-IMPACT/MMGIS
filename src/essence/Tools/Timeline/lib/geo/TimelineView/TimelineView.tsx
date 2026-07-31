import React from 'react'
import type { TimeMode, LayerTimeData } from '../../types'

export interface TimelineViewProps {
    startTime: Date
    endTime: Date
    currentTime: Date
    timeMode: TimeMode
    layers: LayerTimeData[]
    /** Committed time change — fires once the scrubber is released. */
    onCurrentTimeChange: (time: Date) => void
    /** Live time while the scrubber is being dragged, for display only. */
    onCurrentTimePreview?: (time: Date) => void
    onResetZoomReady?: (resetZoomFn: () => void) => void
}

/**
 * Placeholder for the timeline body. Holds the slot the adapter renders into
 * and the prop contract the real view implements; the d3 axes, layer bars and
 * scrubber arrive with the timeline view PR of this stack.
 */
export const TimelineView: React.FC<TimelineViewProps> = () => {
    return <div className="timeline-view-container" />
}
