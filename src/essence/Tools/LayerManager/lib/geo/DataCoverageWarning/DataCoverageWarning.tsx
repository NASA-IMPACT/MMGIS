import React from 'react'
import moment from 'moment'

/** The message for a time given as ISO 8601, named in UTC like the timeline. */
export const noDataMessage = (selectedTime?: string | null): string => {
    const time = selectedTime ? moment.utc(selectedTime) : null
    return time?.isValid()
        ? `Data not available for ${time.format('MMM D, YYYY HH:mm [UTC]')}`
        : 'Data not available for the selected time'
}

export type DataCoverageWarningProps = {
    layerTitle: string
    /** The timeline's current time as ISO 8601. */
    selectedTime?: string | null
}

/**
 * A mark under a layer's name, explaining why the layer is absent from the map
 * rather than broken. It states a condition rather than offering an action, so
 * it takes no focus. The label states the fact; the title carries the time,
 * which is longer than the line has room for.
 */
export function DataCoverageWarning({
    layerTitle,
    selectedTime,
}: DataCoverageWarningProps) {
    const message = noDataMessage(selectedTime)

    return (
        <span
            className="blocks-layer-legend__badge blocks-layer-legend__coverage-warning"
            role="img"
            aria-label={`${layerTitle}: ${message}`}
            title={message}
        >
            No data
        </span>
    )
}
