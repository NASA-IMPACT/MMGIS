import React from 'react'

// Ordered cycle of playback speed multipliers.
export const PLAYBACK_SPEEDS = [1, 2, 4, 0.5] as const

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** Returns the next speed in the 1 → 2 → 4 → 0.5 → 1 cycle. */
export const getNextPlaybackSpeed = (speed: number): PlaybackSpeed => {
    const idx = PLAYBACK_SPEEDS.indexOf(speed as PlaybackSpeed)
    const nextIdx = (idx + 1) % PLAYBACK_SPEEDS.length
    return PLAYBACK_SPEEDS[nextIdx]
}

export interface PlaybackSpeedControlProps {
    speed: number
    onCycleSpeed?: () => void
}

export const PlaybackSpeedControl: React.FC<PlaybackSpeedControlProps> = ({
    speed,
    onCycleSpeed,
}) => {
    return (
        <button
            className="playback-speed-control"
            onClick={onCycleSpeed}
            title="Playback speed"
        >
            {speed}x
        </button>
    )
}
