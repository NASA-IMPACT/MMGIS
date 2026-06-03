import React from 'react'
import type { TimeMode } from '../../types'

export interface TimeModeControlProps {
    currentMode: TimeMode
    onModeChange: (mode: TimeMode) => void
}

const modes: TimeMode[] = ['MONTH', 'DAY', 'HOUR']

export const TimeModeControl: React.FC<TimeModeControlProps> = ({
    currentMode,
    onModeChange,
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
