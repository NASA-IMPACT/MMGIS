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
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
    onPlayToggle,
    onStepForward,
    onStepBackward,
    onGoToStart,
    onGoToEnd,
    isPlaying = false,
    showPlayButton = true
}) => {
    return (
        <div className="playback-controls">
            <button className="playback-btn" onClick={onGoToStart} title="Go to start">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                fill="currentColor" aria-hidden="true">
                    <path d="M7 6L7 18L5 18L5 6L7 6ZM18 6L18 18L9 12L18 6ZM16 9.75L12.6 12L16 14.25L16 9.75Z" />
                </svg>
            </button>
            <button className="playback-btn" onClick={onStepBackward} title="Step backward">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                fill="currentColor" aria-hidden="true">
                    <path d="M17 6L17 18L8 12L17 6ZM15 9.75L11.6 12L15 14.25L15 9.75Z" />
                </svg>
            </button>
            {showPlayButton && (
                <button className="playback-btn play-btn" onClick={onPlayToggle} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20"
                        fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" clipRule="evenodd" d="M4 3H8V17H4V3Z" />
                            <path fillRule="evenodd" clipRule="evenodd" d="M12 3H16V17H12V3Z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20"
                        fill="currentColor" aria-hidden="true">
                            <path d="M5 17V3L17 10L5 17Z" />
                        </svg>
                    )}
                </button>
            )}
            <button className="playback-btn" onClick={onStepForward} title="Step forward">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                fill="currentColor" aria-hidden="true">
                    <path d="M7 18L7 6L16 12L7 18ZM9 14.25L12.4 12L9 9.75L9 14.25Z" />
                </svg>
            </button>
            <button className="playback-btn" onClick={onGoToEnd} title="Go to end">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                fill="currentColor" aria-hidden="true">
                    <path d="M17 18L17 6L19 6L19 18L17 18ZM6 18L6 6L15 12L6 18ZM8 14.25L11.4 12L8 9.75L8 14.25Z" />
                </svg>
            </button>
        </div>
    )
}
