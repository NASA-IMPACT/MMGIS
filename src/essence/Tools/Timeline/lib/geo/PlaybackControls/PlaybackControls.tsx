import React from 'react'

export interface PlaybackControlsProps {
    onPlayToggle?: () => void
    onStepForward?: () => void
    onStepBackward?: () => void
    onGoToStart?: () => void
    onGoToEnd?: () => void
    isPlaying?: boolean
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
    onPlayToggle,
    onStepForward,
    onStepBackward,
    onGoToStart,
    onGoToEnd,
    isPlaying = false
}) => {
    return (
        <div className="playback-controls">
            <button className="playback-btn" onClick={onGoToStart} title="Go to start">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
            </button>
            <button className="playback-btn" onClick={onStepBackward} title="Step backward">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
                </svg>
            </button>
            <button className="playback-btn play-btn" onClick={onPlayToggle} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>
            <button className="playback-btn" onClick={onStepForward} title="Step forward">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                </svg>
            </button>
            <button className="playback-btn" onClick={onGoToEnd} title="Go to end">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
            </button>
        </div>
    )
}
