import React from 'react'

export type AnalyzingPanelProps = {
    label: string
    done: number
    total: number
}

export function AnalyzingPanel({ label, done, total }: AnalyzingPanelProps) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    return (
        <div className="blocks-aoi-panel blocks-aoi-panel--analyzing" role="status" aria-live="polite">
            <div className="blocks-aoi-analyzing__spinner" aria-hidden="true" />
            <p className="blocks-aoi-analyzing__caption">Analyzing</p>
            <p className="blocks-aoi-analyzing__label">{label}</p>
            <p className="blocks-aoi-analyzing__percent">{percent}%</p>
            <div
                className="blocks-aoi-analyzing__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div className="blocks-aoi-analyzing__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="blocks-aoi-analyzing__status">Looking for insights</p>
        </div>
    )
}
