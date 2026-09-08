import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
    ActionIcon,
    BasemapStyle,
    GeocodeResult,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
} from '../../types'
import { useCollapseIfItAddsARow } from '../../hooks/useCollapseIfItAddsARow'
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch'
import { useMeasure } from '../../hooks/useMeasure'
import { FloatingPopover } from '../../FloatingPopover'
import { BasemapPanel } from '../BasemapPanel/BasemapPanel'
import { SearchPanel } from '../SearchPanel/SearchPanel'
import { BasemapIcon, MinusIcon, PlusIcon, RulerIcon, SearchIcon } from '../icons'

export type MapControlBarProps = {
    // Basemap
    basemapStyles?: BasemapStyle[]
    activeBasemap?: BasemapStyle | null
    onSelectBasemap?: (style: BasemapStyle) => void

    // Zoom
    onZoomIn?: () => void
    onZoomOut?: () => void

    // Measure — all three (subscribe/draw/remove) needed to enable the feature
    subscribeToMap?: (handlers: MapSubscribeHandlers) => () => void
    onDrawOverlay?: (opts: MapOverlayOpts) => void
    onRemoveOverlay?: (id: string) => void
    /** Show (or move) the distance label anchored at a map point. */
    onShowMeasureLabel?: (latlng: LatLng, text: string) => void
    onRemoveMeasureLabel?: () => void
    onSetCursor?: (cursor: string) => void

    // Geocode search
    onSearchSelect?: (result: GeocodeResult) => void

    // Action button
    /**
     * Label rendered inside the action button. It doubles as the button's
     * tooltip and accessible name, so it should read as the action itself.
     */
    actionLabel?: string
    /**
     * Optional glyph shown ahead of the label — either an icon-font class or
     * an image the bar paints as a silhouette. An icon is also what lets the
     * button collapse to glyph-only when the bar runs out of room; without one
     * the label always stays visible.
     */
    actionIcon?: ActionIcon
    /**
     * Invoked when the action button is clicked. Supplying it is what makes the
     * button render, matching how the bar gates its other features on the host
     * providing their handlers. What the action does belongs to the host.
     */
    onActionClick?: () => void

    /**
     * Optional element rendered after the bar's built-in controls and before
     * the action button (e.g. a share control). The bar only places it; look
     * and behavior belong to the host.
     */
    endSlot?: React.ReactNode
}

/**
 * The class holding the action button in its glyph-only box. One definition,
 * shared by the markup that renders it and the measurement that toggles it on
 * the node to size the collapsed layout up.
 */
const ACTION_COLLAPSED_CLASS = 'blocks-map-control__btn--collapsed'

/**
 * The class holding the glyph's box. Both icon forms carry it, so the two
 * measure the same however the button is configured — which is what the
 * collapse measurement depends on, since it sizes the collapsed button up from
 * the glyph alone.
 */
const ACTION_ICON_CLASS = 'blocks-map-control__btn-icon'

/**
 * The action button's glyph.
 *
 * An image is painted as a CSS mask rather than an `img` or inline markup.
 * That buys two things at once: the glyph takes its color from the button, so
 * one file reads correctly against the primary fill and matches the label
 * beside it through every hover and active state, and an uploaded SVG is never
 * parsed as a document, so script embedded in one cannot run.
 */
function ActionIconMark({ icon }: { icon: ActionIcon }) {
    if (icon.kind === 'mdi')
        return (
            <i
                className={`${icon.className} ${ACTION_ICON_CLASS}`}
                aria-hidden="true"
            />
        )

    // CSS.escape isn't enough here — the value sits inside a url() in an inline
    // style. Quoting the url and encoding the characters that could close it is
    // what holds the value to being one url: nothing it contains can end the
    // string early and go on to write declarations of its own.
    const src = icon.src.replace(/["'()\\\s]/g, encodeURIComponent)
    return (
        <span
            className={`${ACTION_ICON_CLASS} ${ACTION_ICON_CLASS}--image`}
            style={{
                maskImage: `url("${src}")`,
                WebkitMaskImage: `url("${src}")`,
            }}
            aria-hidden="true"
        />
    )
}

/**
 * A string standing for the configured glyph, for the collapse measurement's
 * signature. The measurement only needs to know when the icon changed, and the
 * two forms are drawn in the same box, so which form it is does not matter —
 * only that a different icon reads as a different value.
 */
function actionIconKey(icon: ActionIcon | undefined): string {
    if (!icon) return ''
    return icon.kind === 'mdi' ? icon.className : icon.src
}

export function MapControlBar({
    basemapStyles = [],
    activeBasemap = null,
    onSelectBasemap,
    onZoomIn,
    onZoomOut,
    subscribeToMap,
    onDrawOverlay,
    onRemoveOverlay,
    onShowMeasureLabel,
    onRemoveMeasureLabel,
    onSetCursor,
    onSearchSelect,
    actionLabel = 'Analyze area',
    actionIcon,
    onActionClick,
    endSlot,
}: MapControlBarProps) {
    const barRef = useRef<HTMLDivElement>(null)
    const actionBtnRef = useRef<HTMLButtonElement>(null)
    const searchBtnRef = useRef<HTMLButtonElement>(null)
    const basemapBtnRef = useRef<HTMLButtonElement>(null)
    const measureBtnRef = useRef<HTMLButtonElement>(null)
    const searchPopoverId = useId()
    const basemapPopoverId = useId()
    const [basemapOpen, setBasemapOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const measure = useMeasure({
        subscribeToMap,
        onDrawOverlay,
        onRemoveOverlay,
        onShowMeasureLabel,
        onRemoveMeasureLabel,
        onSetCursor,
    })
    const { results, loading } = useDebouncedSearch(searchOpen ? searchQuery : '')

    // Escape exits measure mode. An open panel's own Escape handler fires on
    // the same press (both listen on document), so the panel closes and
    // measure exits together.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return
            measure.stop()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [measure.stop])

    const closeBasemap = useCallback(() => setBasemapOpen(false), [])
    const closeSearch = useCallback(() => setSearchOpen(false), [])

    // Clear the query when the search panel closes
    useEffect(() => {
        if (!searchOpen) setSearchQuery('')
    }, [searchOpen])

    const current = activeBasemap ?? (basemapStyles[0] ?? null)
    const hasStyles = basemapStyles.length > 0
    const hasZoom = Boolean(onZoomIn && onZoomOut)

    // The action button gives up its label only where showing it would push the
    // row onto another line. Collapsing needs a glyph to fall back to, so a
    // button configured without one is left out of the measurement entirely.
    //
    // The signature names everything that decides the outcome besides the bar's
    // width: which controls share the row, and the icon and label the button
    // asks room for. It deliberately leaves out the bar's transient state —
    // open panels and measure-mode redraws re-render the bar many times over
    // without moving a control, and each re-measure costs the document a
    // synchronous layout.
    const actionCollapsed = useCollapseIfItAddsARow({
        rowRef: barRef,
        itemRef: actionBtnRef,
        collapsedClass: ACTION_COLLAPSED_CLASS,
        enabled: Boolean(onActionClick && actionIcon),
        signature: [
            Boolean(onSearchSelect),
            hasStyles,
            measure.supported,
            hasZoom,
            Boolean(endSlot),
            actionIconKey(actionIcon),
            actionLabel,
        ].join('|'),
    })

    function toggleBasemap() {
        setBasemapOpen((v) => !v)
        setSearchOpen(false)
    }
    function toggleSearch() {
        setSearchOpen((v) => !v)
        setBasemapOpen(false)
    }
    function toggleMeasure() {
        setBasemapOpen(false)
        setSearchOpen(false)
        measure.toggle()
    }
    function handleSearchSelect(r: GeocodeResult) {
        setSearchOpen(false)
        onSearchSelect?.(r)
    }

    return (
        <div className="blocks-map-control">
            <div ref={barRef} className="blocks-map-control__bar">
                {onSearchSelect && (
                    <div className="blocks-map-control__group">
                        <button
                            ref={searchBtnRef}
                            type="button"
                            className={`blocks-map-control__btn${searchOpen ? ' blocks-map-control__btn--active' : ''}`}
                            onClick={toggleSearch}
                            title="Geocode search"
                            aria-expanded={searchOpen}
                            aria-controls={searchOpen ? searchPopoverId : undefined}
                        >
                            <SearchIcon />
                        </button>
                    </div>
                )}
                {hasStyles && (
                    <div className="blocks-map-control__group">
                        <button
                            ref={basemapBtnRef}
                            type="button"
                            className={`blocks-map-control__btn${basemapOpen ? ' blocks-map-control__btn--active' : ''}`}
                            onClick={toggleBasemap}
                            title={current ? `Basemap: ${current.name}` : 'Basemap'}
                            aria-expanded={basemapOpen}
                            aria-controls={basemapOpen ? basemapPopoverId : undefined}
                        >
                            <BasemapIcon />
                        </button>
                    </div>
                )}
                {measure.supported && (
                    <div className="blocks-map-control__group">
                        <button
                            ref={measureBtnRef}
                            type="button"
                            className={`blocks-map-control__btn${measure.measuring ? ' blocks-map-control__btn--active' : ''}`}
                            onClick={toggleMeasure}
                            title={measure.measuring ? 'Exit measure mode (Esc)' : 'Measure distance'}
                        >
                            <RulerIcon />
                        </button>
                    </div>
                )}
                {hasZoom && (
                    <div className="blocks-map-control__group blocks-map-control__group--pair">
                        <button type="button" className="blocks-map-control__btn" onClick={onZoomOut} title="Zoom out">
                            <MinusIcon />
                        </button>
                        <span className="blocks-map-control__divider" />
                        <button type="button" className="blocks-map-control__btn" onClick={onZoomIn} title="Zoom in">
                            <PlusIcon />
                        </button>
                    </div>
                )}
                {endSlot}
                {/* Built from the same __group and __btn classes as the icon
                    buttons, so it sits in the row at their height and box. The
                    --wide and --action modifiers relax the square icon sizing
                    to fit a text label and fill the button in the theme's
                    primary, which restates the color treatment the icon
                    buttons take from __btn.

                    The two collapse modifiers say different things and the
                    stylesheet draws the glyph-only box only for a button
                    carrying both. --collapsible is a standing fact about the
                    configuration: there is a glyph to fall back to, so giving
                    the label up leaves something behind rather than an empty
                    box. --collapsed is the measurement's answer for the width
                    the bar is at, and it is only ever asked for a collapsible
                    button.

                    The label's span stays in the markup either way and the
                    stylesheet hides it, so the text is on the element whether
                    or not it is on screen. aria-label repeats it so the button
                    keeps its accessible name while it is hidden; it matches
                    the text exactly, so it never disagrees with what is
                    drawn. */}
                {onActionClick && (
                    <div className="blocks-map-control__group blocks-map-control__group--wide">
                        <button
                            ref={actionBtnRef}
                            type="button"
                            className={[
                                'blocks-map-control__btn',
                                'blocks-map-control__btn--action',
                                actionIcon ? 'blocks-map-control__btn--collapsible' : '',
                                actionCollapsed ? ACTION_COLLAPSED_CLASS : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onClick={onActionClick}
                            title={actionLabel}
                            aria-label={actionLabel}
                        >
                            {actionIcon && <ActionIconMark icon={actionIcon} />}
                            <span className="blocks-map-control__btn-label">{actionLabel}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Portaled to <body> so the panel clears the floating panel card
                the bar sits in, which clips its overflow. */}
            {hasStyles && (
                <FloatingPopover
                    id={basemapPopoverId}
                    anchorRef={basemapBtnRef}
                    isOpen={basemapOpen}
                    onClose={closeBasemap}
                    placement="bottom"
                    offset={6}
                    label="Basemap style"
                    autoFocus
                >
                    <BasemapPanel
                        styles={basemapStyles}
                        active={current}
                        onSelect={(entry) => {
                            onSelectBasemap?.(entry)
                            setBasemapOpen(false)
                        }}
                    />
                </FloatingPopover>
            )}

            {/* Portaled like the basemap panel. Focus moves into the surface on
                open so the query field takes typing straight away. */}
            <FloatingPopover
                id={searchPopoverId}
                anchorRef={searchBtnRef}
                isOpen={searchOpen}
                onClose={closeSearch}
                placement="bottom"
                offset={6}
                label="Search for a location"
                autoFocus
            >
                <SearchPanel
                    query={searchQuery}
                    results={results}
                    loading={loading}
                    onQueryChange={setSearchQuery}
                    onSelect={handleSearchSelect}
                />
            </FloatingPopover>
        </div>
    )
}
