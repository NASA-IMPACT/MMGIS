import React from 'react'
import { navigateLayer } from '../../utils/layerNavigation'
import type { LayerNavigation } from '../../utils/layerNavigation'
import { TimeMode } from '../../types'
import './LayerNavControls.css'

export interface LayerNavControlsProps {
    /**
     * The layer's display name. Every control carries it in its accessible
     * name: four identically shaped buttons repeat on every row of the
     * sidebar, and the layer is the only thing telling one row's set from
     * another's when they are read out of their visual context.
     */
    displayName: string
    /** Where this layer's data lets the controls put the current time. */
    navigation: LayerNavigation
    /** The current time each control moves away from. */
    from: Date
    /** The timeline's granularity, the step a periodic layer moves by. */
    timeMode: TimeMode
    /** Given the instant the pressed control leads to. */
    onNavigate: (target: Date) => void
}

/**
 * The transport glyphs of the global playback controls, drawn in the same
 * 24-unit space and sized down by the button to sit inside a layer row.
 */
const ACTIONS: {
    action: 'first' | 'prev' | 'next' | 'last'
    name: string
    path: string
}[] = [
    {
        action: 'first',
        name: 'first date',
        path: 'M7 6L7 18L5 18L5 6L7 6ZM18 6L18 18L9 12L18 6ZM16 9.75L12.6 12L16 14.25L16 9.75Z'
    },
    {
        action: 'prev',
        name: 'previous date',
        path: 'M17 6L17 18L8 12L17 6ZM15 9.75L11.6 12L15 14.25L15 9.75Z'
    },
    {
        action: 'next',
        name: 'next date',
        path: 'M7 18L7 6L16 12L7 18ZM9 14.25L12.4 12L9 9.75L9 14.25Z'
    },
    {
        action: 'last',
        name: 'last date',
        path: 'M17 18L17 6L19 6L19 18L17 18ZM6 18L6 6L15 12L6 18ZM8 14.25L11.4 12L8 9.75L8 14.25Z'
    }
]

/**
 * One layer row's first/previous/next/last controls, moving the timeline's
 * current time through that layer's own data instead of leaving the viewer to
 * find it with the global scrubber.
 *
 * Where a press lands is the navigation model's answer throughout — the row
 * asks for each control's target and does no time arithmetic of its own — so a
 * control is drawn inert on exactly the condition the model reports nowhere to
 * go, and a layer's stops and its extent behave here however they behave there.
 */
export const LayerNavControls: React.FC<LayerNavControlsProps> = ({
    displayName,
    navigation,
    from,
    timeMode,
    onNavigate
}) => {
    return (
        <div
            className="layer-nav-controls"
            role="group"
            aria-label={`${displayName} date navigation`}
        >
            {ACTIONS.map(({ action, name, path }) => {
                const target = navigateLayer(navigation, from, action, timeMode)
                const label = `${displayName}: ${name}`

                return (
                    <button
                        key={action}
                        type="button"
                        className="layer-nav-btn"
                        onClick={() => {
                            if (target) onNavigate(target)
                        }}
                        title={label}
                        aria-label={label}
                        disabled={target === null}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                        fill="currentColor" aria-hidden="true" focusable="false">
                            <path d={path} />
                        </svg>
                    </button>
                )
            })}
        </div>
    )
}
