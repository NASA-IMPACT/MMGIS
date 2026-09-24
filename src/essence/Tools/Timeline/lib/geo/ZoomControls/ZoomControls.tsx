import React from 'react'
import { describeSpan } from '../../utils/zoomWindow'
import './ZoomControls.css'

export interface ZoomControlsProps {
    /** Where the view sits on the slider, 0 (full window) to 1 (floor). */
    sliderValue: number
    /** The visible span, read aloud by the slider. */
    spanMs: number
    /** False when the global window has no more travel than the floor. */
    canZoom: boolean
    /** False when no visible layer carries bounds of its own to frame. */
    canFit: boolean
    /** Standing intent to keep the view framed as layers come and go. */
    autoFit: boolean
    onZoomIn: () => void
    onZoomOut: () => void
    onSliderChange: (v: number) => void
    onToggleAutoFit: () => void
    onFitNow: () => void
}

const ZOOM_OUT_ICON = 'M5 10.5h14v3H5z'
const ZOOM_IN_ICON = 'M10.5 5h3v5.5H19v3h-5.5V19h-3v-5.5H5v-3h5.5z'

/** Corner brackets: a frame standing for the view being held to the data. */
const AUTO_FIT_ICON =
    'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z'

/** The same frame with a solid centre: fit now, rather than keep fitting. */
const FIT_NOW_ICON = `${AUTO_FIT_ICON}M9 9h6v6H9z`

/**
 * The header's zoom group: out, a slider, in, the auto-fit toggle and a
 * one-shot fit.
 *
 * There is no reset button. The slider's zero position is the full global
 * window, which is all a reset ever did, so a separate control for it would be
 * a second way to do one thing.
 *
 * The toggle and the one-shot fit are separate controls because they answer
 * different questions. The toggle is standing intent — keep me framed as
 * layers come and go — and it survives a manual zoom rather than being
 * switched off by one. That leaves a gap it cannot fill: armed, manually
 * zoomed, and the only way back to the fit would be to disarm and rearm a lit
 * button. The one-shot fit closes it in one press.
 */
export const ZoomControls: React.FC<ZoomControlsProps> = ({
    sliderValue,
    spanMs,
    canZoom,
    canFit,
    autoFit,
    onZoomIn,
    onZoomOut,
    onSliderChange,
    onToggleAutoFit,
    onFitNow,
}) => (
    <div className="timeline-zoom-controls" role="group" aria-label="Zoom">
        <button
            type="button"
            className="timeline-tool-btn"
            onClick={onZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!canZoom || sliderValue <= 0}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="currentColor" aria-hidden="true" focusable="false">
                <path d={ZOOM_OUT_ICON} />
            </svg>
        </button>

        {/* A native range input rather than a custom control, so it is
            keyboard-operable and reaches assistive technology without
            reimplementing either. The raw 0–1 position means nothing spoken
            aloud, so the span it stands for is what gets read.

            An arrow press moves one step, so the step sets how many presses
            span the track: a hundred positions keep a logarithmic slider
            smooth without making the keyboard walk endless. */}
        <input
            type="range"
            className="timeline-zoom-slider"
            min={0}
            max={1}
            step={0.01}
            value={sliderValue}
            /* The covered range is painted from this; CSS cannot read it. */
            style={
                {
                    '--timeline-zoom-fill': `${sliderValue * 100}%`,
                } as React.CSSProperties
            }
            onChange={(event) => onSliderChange(Number(event.target.value))}
            disabled={!canZoom}
            aria-label="Zoom level"
            aria-valuetext={describeSpan(spanMs)}
        />

        <button
            type="button"
            className="timeline-tool-btn"
            onClick={onZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!canZoom || sliderValue >= 1}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="currentColor" aria-hidden="true" focusable="false">
                <path d={ZOOM_IN_ICON} />
            </svg>
        </button>

        <button
            type="button"
            className={`timeline-tool-btn timeline-zoom-autofit${autoFit ? ' timeline-zoom-autofit--on' : ''}`}
            onClick={onToggleAutoFit}
            title="Auto-fit to visible layers"
            aria-label="Auto-fit to visible layers"
            aria-pressed={autoFit}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="currentColor" aria-hidden="true" focusable="false">
                <path d={AUTO_FIT_ICON} />
            </svg>
        </button>

        <button
            type="button"
            className="timeline-tool-btn"
            onClick={onFitNow}
            title="Fit to visible layers"
            aria-label="Fit to visible layers"
            disabled={!canFit}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="currentColor" aria-hidden="true" focusable="false">
                <path d={FIT_NOW_ICON} />
            </svg>
        </button>
    </div>
)
