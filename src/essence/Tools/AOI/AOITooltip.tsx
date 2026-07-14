import React from 'react'
import './AOIComponent/AOIComponent.scss'

export interface AOITooltipProps {
    label: string
    position: { x: number; y: number }
    analyzeEnabled: boolean
    onAnalyze: () => void
    onCancel: () => void
}

export function AOITooltip(props: AOITooltipProps) {
    return (
        <div
            className="aoi-tooltip"
            style={{ left: props.position.x, top: props.position.y }}
            role="dialog"
            aria-label="Confirm analysis area"
        >
            <p className="aoi-tooltip__label">{props.label}</p>
            <div className="aoi-tooltip__actions">
                <button
                    type="button"
                    className="aoi-tooltip__primary"
                    onClick={props.onAnalyze}
                    disabled={!props.analyzeEnabled}
                >
                    Analyze area
                </button>
                <button
                    type="button"
                    className="aoi-tooltip__secondary"
                    onClick={props.onCancel}
                >
                    Cancel
                </button>
            </div>
        </div>
    )
}

export default AOITooltip
