import React from 'react'
import type { ContainerPoint, LatLng } from '../../types'
import { formatDistance, measureDistance } from '../../utils/measure'

export type MeasureLabelProps = {
    /** The two-point segment being measured. */
    segment: [LatLng, LatLng]
    /** Pixel position (map-container-relative) to anchor the label. */
    pixel: ContainerPoint
}

export function MeasureLabel({ segment, pixel }: MeasureLabelProps) {
    return (
        <div className="blocks-measure-label" style={{ left: pixel.x, top: pixel.y }}>
            {formatDistance(measureDistance(segment[0], segment[1]))}
        </div>
    )
}
