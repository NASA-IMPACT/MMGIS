import React from 'react'
import {
    useState,
    useRef,
    useEffect,
    useCallback,
    useId,
    type MouseEvent,
    type PointerEvent,
} from 'react'
import { FloatingPopover } from '../../FloatingPopover'
import { describeDataCoverage } from '../../utils/dataCoverageWording'
import { COVERAGE_POPOVER_CLOSE_DELAY_MS } from '../../utils/constants'
import type { DataCoverage } from '../../types'

/**
 * Reads a layer's coverage as it stands. The record a row holds is replaced
 * only when the verdict or the coverage changes, while the window the layer
 * would request moves on every time step, so the instant is worded from what
 * this answers each time the popover opens.
 */
export type GetDataCoverage = (layerId: string) => Promise<DataCoverage | null>

export type DataCoverageWarningProps = {
    layerId: string
    layerTitle: string
    /** The row's record. Worded as is when there is no `getDataCoverage`. */
    coverage: DataCoverage
    getDataCoverage?: GetDataCoverage
}

/** What is holding the popover open. It is open while anything is. */
type Holds = {
    /** A mouse or pen over the icon or the popover. */
    pointer: boolean
    /** Focus on the icon. */
    focus: boolean
    /** A click, a tap, or Enter or Space on the focused icon. */
    click: boolean
}

const RELEASED: Holds = { pointer: false, focus: false, click: false }

/**
 * A calendar warning beside a layer's name, explaining why the layer is absent
 * from the map rather than broken. Hovering, focus, or a click, tap, Enter or
 * Space shows what time is being asked for and when the layer does have
 * data. Focus stays on the icon: the popover is informational, with nothing
 * inside to operate.
 */
export function DataCoverageWarning({
    layerId,
    layerTitle,
    coverage,
    getDataCoverage,
}: DataCoverageWarningProps) {
    const [holds, setHolds] = useState<Holds>(RELEASED)
    // Undefined while the answer is outstanding; null when there is none.
    const [current, setCurrent] = useState<DataCoverage | null | undefined>(
        undefined,
    )
    const btnRef = useRef<HTMLButtonElement | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const popoverId = useId()
    const descriptionId = useId()

    const isOpen = holds.pointer || holds.focus || holds.click

    const hold = useCallback((by: keyof Holds, on: boolean) => {
        setHolds((held) => (held[by] === on ? held : { ...held, [by]: on }))
    }, [])

    const cancelClose = useCallback(() => {
        if (closeTimer.current === null) return
        clearTimeout(closeTimer.current)
        closeTimer.current = null
    }, [])

    useEffect(() => cancelClose, [cancelClose])

    // Escape, a press elsewhere and a click on the held-open icon all close it
    // through here, releasing every hold at once: one left behind would keep
    // the next opening open after its own reason had gone.
    const close = useCallback(() => {
        cancelClose()
        setHolds(RELEASED)
    }, [cancelClose])

    // Shared by the icon and the popover, so moving from one to the other
    // cancels the release the first one scheduled. The delay lets the pointer
    // cross the gap between them. A touch has no hover; its tap arrives as a
    // click.
    const handlePointerEnter = useCallback(
        (e: PointerEvent) => {
            if (e.pointerType === 'touch') return
            cancelClose()
            hold('pointer', true)
        },
        [cancelClose, hold],
    )

    const handlePointerLeave = useCallback(
        (e: PointerEvent) => {
            if (e.pointerType === 'touch') return
            cancelClose()
            closeTimer.current = setTimeout(() => {
                closeTimer.current = null
                hold('pointer', false)
            }, COVERAGE_POPOVER_CLOSE_DELAY_MS)
        },
        [cancelClose, hold],
    )

    // A mouse hovers before it clicks, and a tap or a press focuses before it
    // clicks, so the popover is usually open already when a pointer's click
    // lands: that first click holds it open, and the next one closes it.
    // Enter or Space — a click with no click count — lands on a popover that
    // focus opened, and closes it, so the key never seems to do nothing.
    const handleClick = (e: MouseEvent) => {
        const fromKeyboard = e.detail === 0
        if (holds.click || (fromKeyboard && holds.focus)) close()
        else hold('click', true)
    }

    // Tabbing away lets go of a click's hold too.
    const handleBlur = () => {
        setHolds((held) => ({ ...held, focus: false, click: false }))
    }

    // Focus stays on the icon, as the popover holds nothing to operate. A
    // press on the popover would otherwise focus it, and it hands focus back
    // to the icon as it closes — which the icon's focus hold would take as a
    // reason to open again.
    const keepFocusOnIcon = useCallback((e: MouseEvent) => {
        e.preventDefault()
    }, [])

    // Read through a ref so that opening and changing layer are the only
    // things that ask again, whatever identity the caller's callback has.
    const getDataCoverageRef = useRef(getDataCoverage)
    useEffect(() => {
        getDataCoverageRef.current = getDataCoverage
    })

    useEffect(() => {
        if (!isOpen) return
        const read = getDataCoverageRef.current
        if (!read) return
        let cancelled = false
        read(layerId).then(
            (record) => {
                if (!cancelled) setCurrent(record)
            },
            () => {
                if (!cancelled) setCurrent(null)
            },
        )
        return () => {
            cancelled = true
            // Cleared on close, so a reopening never shows the last answer.
            setCurrent(undefined)
        }
    }, [isOpen, layerId])

    // Without a way to ask, the row's record is the freshest there is. With
    // one, the instant waits for the answer rather than naming a stale one,
    // and the coverage reads from the row's record until the answer has
    // coverage of its own to word.
    const fresh = getDataCoverage ? current : coverage
    const freshWording = describeDataCoverage(fresh)
    const wording = freshWording ?? describeDataCoverage(coverage)
    const instant = freshWording?.instant ?? null
    const explanation = [instant, wording?.coverage].filter(Boolean).join('. ')

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className="blocks-layer-legend__coverage-warning"
                aria-label={`No data at this time for ${layerTitle}`}
                aria-describedby={descriptionId}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onFocus={() => hold('focus', true)}
                onBlur={handleBlur}
                onClick={handleClick}
            >
                <span
                    className="blocks-layer-legend__icon blocks-layer-legend__icon--no-data"
                    aria-hidden="true"
                />
            </button>
            {/* Always present, unlike the popover: a screen reader reads the
                description once, as focus lands, before anything has opened.
                Hidden outright, which a description may be, so browse mode
                doesn't read it a second time after the button. */}
            <span id={descriptionId} hidden>
                {explanation}
            </span>
            {/* Portaled like the row's other popovers, so it clears the layer
                list's clipped overflow. */}
            <FloatingPopover
                id={popoverId}
                anchorRef={btnRef}
                isOpen={isOpen}
                onClose={close}
                placement="bottom"
                offset={6}
                className="blocks-layer-legend__coverage-popover"
                label={`No data at this time for ${layerTitle}`}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onMouseDown={keepFocusOnIcon}
            >
                <div className="blocks-layer-legend__coverage-title">
                    {wording?.title ?? 'No data at this time'}
                </div>
                {instant && <div>{instant}</div>}
                {wording?.coverage && <div>{wording.coverage}</div>}
            </FloatingPopover>
        </>
    )
}
