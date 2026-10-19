import React from 'react'
import type { ScaleBarModel } from '../../_shared/scale/scaleBarModel'

export type ScaleBarProps = {
    model: ScaleBarModel | null
}

/**
 * A bracket `model.widthPx` CSS pixels long with its distance above it.
 * Renders nothing while the scale is unknown.
 */
export function ScaleBar({ model }: ScaleBarProps) {
    if (!model) return null
    return (
        <div className="blocks-scale-bar" role="img" aria-label={`Scale: ${model.label}`}>
            <span className="blocks-scale-bar__label">{model.label}</span>
            <div
                className="blocks-scale-bar__rule"
                style={{ width: `${model.widthPx}px` }}
            />
        </div>
    )
}
