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
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" 
                stroke-linejoin="round" className="lucide lucide-skip-back w-3.5 h-3.5" aria-hidden="true">
                    <path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" />
                    <path d="M3 20V4"/>
                </svg>
            </button>
            <button className="playback-btn" onClick={onStepBackward} title="Step backward">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" 
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
                className="lucide lucide-step-back w-3.5 h-3.5" aria-hidden="true">
                    <path d="M13.971 4.285A2 2 0 0 1 17 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/>
                    <path d="M21 20V4"/>
                </svg>
            </button>
            {showPlayButton && (
                <button className="playback-btn play-btn" onClick={onPlayToggle} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        className="lucide lucide-pause w-4 h-4 fill-current" aria-hidden="true">
                            <rect x="14" y="3" width="5" height="18" rx="1"></rect>
                            <rect x="5" y="3" width="5" height="18" rx="1"></rect>
                        </svg>
                    ) : (
                         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        className="lucide lucide-play w-4 h-4 fill-current ml-px" aria-hidden="true">
                            <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>
                        </svg>
                    )}
                </button>
            )}
            <button className="playback-btn" onClick={onStepForward} title="Step forward">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" 
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
                className="lucide lucide-step-forward w-3.5 h-3.5" aria-hidden="true">
                    <path d="M10.029 4.285A2 2 0 0 0 7 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>
                    <path d="M3 4v16"/>
                </svg>
            </button>
            <button className="playback-btn" onClick={onGoToEnd} title="Go to end">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" 
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" 
                className="lucide lucide-skip-forward w-3.5 h-3.5" aria-hidden="true">
                    <path d="M21 4v16"/>
                    <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>
                </svg>
            </button>
        </div>
    )
}
