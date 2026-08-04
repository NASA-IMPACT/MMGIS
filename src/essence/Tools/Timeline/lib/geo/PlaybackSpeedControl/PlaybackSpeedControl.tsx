import React from 'react'

// Ordered cycle of playback speed multipliers.
export const PLAYBACK_SPEEDS = [1, 2, 4, 0.5] as const

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/**
 * Returns the next speed in the 1 → 2 → 4 → 0.5 → 1 cycle. A speed outside the
 * cycle restarts it, so the playback interval can never be handed a zero or
 * negative multiplier.
 */
export const getNextPlaybackSpeed = (speed: number): PlaybackSpeed => {
    const idx = PLAYBACK_SPEEDS.indexOf(speed as PlaybackSpeed)
    if (idx === -1) return PLAYBACK_SPEEDS[0]
    return PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length]
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
            type="button"
            className="playback-speed-control"
            onClick={onCycleSpeed}
            title="Playback speed"
            aria-label={`Playback speed: ${speed}x. Activate to change.`}
        >
            {speed}x
        </button>
    )
}
