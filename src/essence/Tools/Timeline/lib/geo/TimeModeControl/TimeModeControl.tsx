import React from 'react'
import { TIME_MODE_ORDER, type TimeMode } from '../../types'

export interface TimeModeControlProps {
    currentMode: TimeMode
    onModeChange: (mode: TimeMode) => void
    /** Which modes to show, in display order. Defaults to all modes. */
    modes?: TimeMode[]
}

export const TimeModeControl: React.FC<TimeModeControlProps> = ({
    currentMode,
    onModeChange,
    modes = TIME_MODE_ORDER,
}) => {
    return (
        <div className="time-mode-control">
            {modes.map((mode) => (
                <button
                    key={mode}
                    className={`time-mode-button ${currentMode === mode ? 'active' : ''}`}
                    onClick={() => onModeChange(mode)}
                    type="button"
                >
                    {mode}
                </button>
            ))}
        </div>
    )
}
