import React from 'react'

export interface PlaybackControlsProps {
    onPlayToggle?: () => void
    onStepForward?: () => void
    onStepBackward?: () => void
    onGoToStart?: () => void
    onGoToEnd?: () => void
    isPlaying?: boolean
    /** When false, the play/pause button is hidden (step and skip buttons remain). */
    showPlayButton?: boolean
    /** False once the current time sits at the end of the range. */
    canStepForward?: boolean
    /** False once the current time sits at the start of the range. */
    canStepBackward?: boolean
}

/**
 * Placeholder for the transport controls. Holds the slot and the prop contract
 * the adapter already wires up; the play, step and skip buttons arrive with the
 * playback controls PR of this stack.
 */
export const PlaybackControls: React.FC<PlaybackControlsProps> = () => {
    return <div className="playback-controls" />
}
