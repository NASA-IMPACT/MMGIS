import React, { useMemo } from 'react'
import { navigateLayer } from '../../utils/layerNavigation'
import type { LayerNavigation } from '../../utils/layerNavigation'
import { TimeMode } from '../../types'
import './LayerNavControls.css'

export interface LayerNavControlsProps {
    /**
     * Prefixes every control's accessible name. The same four buttons repeat
     * on every row, so the layer is all that tells one row's set from another's
     * when they are read out of their visual context.
     */
    displayName: string
    navigation: LayerNavigation
    /** The current time each control moves away from. */
    from: Date
    /** The timeline's granularity, the step a periodic layer moves by. */
    timeMode: TimeMode
    /** Given the instant the pressed control leads to. */
    onNavigate: (target: Date) => void
}

/** The global playback controls' transport glyphs, in the same 24-unit space. */
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
 * current time through that layer's own data. Both the target and the inert
 * state come from `navigateLayer`; the row does no time arithmetic of its own.
 */
export const LayerNavControls: React.FC<LayerNavControlsProps> = ({
    displayName,
    navigation,
    from,
    timeMode,
    onNavigate
}) => {
    // Held across renders: the current time moves with every frame of a
    // scrubber drag and every playback tick, each of which renders every row.
    const targets = useMemo(
        () =>
            ACTIONS.map(({ action }) =>
                navigateLayer(navigation, from, action, timeMode)
            ),
        [navigation, from, timeMode]
    )

    return (
        <div
            className="layer-nav-controls"
            role="group"
            aria-label={`${displayName} date navigation`}
        >
            {ACTIONS.map(({ action, name, path }, i) => {
                const target = targets[i]
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
                        // Stated rather than enforced: a browser blurs an
                        // element the moment it is disabled, so a control
                        // pressed until it had nowhere left to go would drop
                        // focus, and with it the :focus-within revealing the
                        // group. The handler's guard silences the press.
                        aria-disabled={target === null}
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
