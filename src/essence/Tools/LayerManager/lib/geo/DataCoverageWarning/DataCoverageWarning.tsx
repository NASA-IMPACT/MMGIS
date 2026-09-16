import React from 'react'
import { useState, useRef, useCallback, useId, type PointerEvent } from 'react'
import moment from 'moment'
import { FloatingPopover } from '../../FloatingPopover'

/** The message for a time given as ISO 8601, named in UTC like the timeline. */
export const noDataMessage = (selectedTime?: string | null): string => {
    const time = selectedTime ? moment.utc(selectedTime) : null
    return time?.isValid()
        ? `Data not available for ${time.format('MMM D, YYYY HH:mm [UTC]')}`
        : 'Data not available for the selected time'
}

export type DataCoverageWarningProps = {
    layerTitle: string
    /** The timeline's current time as ISO 8601. */
    selectedTime?: string | null
}

/**
 * A warning beside a layer's name, explaining why the layer is absent from
 * the map rather than broken. Hover or focus shows the message; a click or
 * tap keeps it open until Escape, a press elsewhere, or focus moves on.
 */
export function DataCoverageWarning({
    layerTitle,
    selectedTime,
}: DataCoverageWarningProps) {
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const [pinned, setPinned] = useState(false)
    const btnRef = useRef<HTMLButtonElement | null>(null)
    const popoverId = useId()

    const close = useCallback(() => {
        setHovered(false)
        setFocused(false)
        setPinned(false)
    }, [])

    // A touch has no hover; its tap arrives as a click.
    const onHover = (on: boolean) => (e: PointerEvent) => {
        if (e.pointerType !== 'touch') setHovered(on)
    }

    const message = noDataMessage(selectedTime)
    const label = `${layerTitle}: ${message}`

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className="blocks-layer-legend__coverage-warning"
                aria-label={label}
                onPointerEnter={onHover(true)}
                onPointerLeave={onHover(false)}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                    setFocused(false)
                    setPinned(false)
                }}
                onClick={() => setPinned(true)}
            >
                <span
                    className="blocks-layer-legend__icon blocks-layer-legend__icon--no-data"
                    aria-hidden="true"
                />
            </button>
            {/* Portaled like the row's other popovers, so it clears the layer
                list's clipped overflow. */}
            <FloatingPopover
                id={popoverId}
                anchorRef={btnRef}
                isOpen={hovered || focused || pinned}
                onClose={close}
                placement="bottom"
                offset={6}
                className="blocks-layer-legend__coverage-popover"
                label={label}
            >
                <div className="blocks-layer-legend__coverage-body">
                    <span
                        className="blocks-layer-legend__icon blocks-layer-legend__icon--no-data blocks-layer-legend__coverage-icon"
                        aria-hidden="true"
                    />
                    <div className="blocks-layer-legend__coverage-title">
                        {message}
                    </div>
                </div>
            </FloatingPopover>
        </>
    )
}
