import React from 'react'
import { TIME_MODE_ORDER, type TimeMode } from '../../types'

export interface TimeModeControlProps {
    currentMode: TimeMode
    onModeChange: (mode: TimeMode) => void
    /** Which modes to show, in display order. Defaults to all modes. */
    modes?: TimeMode[]
}

// A native select rather than a custom listbox, so keyboard and assistive
// technology support come from the browser.
export const TimeModeControl: React.FC<TimeModeControlProps> = ({
    currentMode,
    onModeChange,
    modes = TIME_MODE_ORDER,
}) => {
    return (
        <select
            className="time-mode-control"
            value={currentMode}
            onChange={(event) => onModeChange(event.target.value as TimeMode)}
            aria-label="Time granularity"
            title="Time granularity"
        >
            {modes.map((mode) => (
                <option key={mode} value={mode}>
                    {mode}
                </option>
            ))}
        </select>
    )
}
