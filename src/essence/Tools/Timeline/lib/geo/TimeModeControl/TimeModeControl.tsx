import React from 'react'
import { type TimeMode } from '../../types'

export interface TimeModeControlProps {
    currentMode: TimeMode
    onModeChange: (mode: TimeMode) => void
    /** Which modes to show, in display order. Defaults to all modes. */
    modes?: TimeMode[]
}

/**
 * Placeholder for the granularity switcher. Renders an empty slot; the
 * YEAR/MONTH/DAY/HOUR buttons arrive with the time mode control PR of this
 * stack.
 */
export const TimeModeControl: React.FC<TimeModeControlProps> = () => {
    return <div className="time-mode-control" />
}
