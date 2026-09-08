import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
    ActionIcon,
    BasemapStyle,
    GeocodeResult,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
} from '../../types'
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
     * Text rendered inside the action button, which also serves as its tooltip
     * and accessible name — so it should read as the action itself. Left unset
     * the button draws its glyph alone; the host owns any wording to fall back
     * on, since the bar has no idea what the action does.
     */
    actionLabel?: string
    /**
     * Glyph drawn ahead of the label — either an icon-font class or an image
     * the bar paints as a silhouette. Left unset the button draws its label
     * alone.
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
 * The class holding the glyph's box. Both icon forms carry it, so an icon-font
 * glyph and an image are drawn at the same size — and the image, being a mask
 * with no intrinsic size, has a box at all.
 */
const ACTION_ICON_CLASS = 'blocks-map-control__btn-icon'

/**
 * The action button's accessible name where no label is configured, leaving
 * only a glyph on screen. Generic on purpose: the bar knows the control is the
 * row's action and nothing more about it.
 */
const ACTION_FALLBACK_NAME = 'Action'

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
    actionLabel,
    actionIcon,
    onActionClick,
    endSlot,
}: MapControlBarProps) {
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

    // A glyph-only button carries no text, so the name falls back to a generic
    // one rather than leaving the control unnamed. title matches it, so the
    // tooltip and the accessible name never disagree.
    const actionName = actionLabel || ACTION_FALLBACK_NAME

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
            <div className="blocks-map-control__bar">
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
                    buttons, so it sits in the row at their height. --wide
                    hands the slot the row's free width; --action fills the
                    button in the theme's primary and sizes it from its
                    contents rather than as a square. It draws whatever it was
                    handed — glyph, label, or both. */}
                {onActionClick && (
                    /* The slot only claims the row's free width when there is a
                       label to spend it on; a glyph on its own sizes like the
                       bar's other icon buttons. */
                    <div
                        className={`blocks-map-control__group${actionLabel ? ' blocks-map-control__group--wide' : ''}`}
                    >
                        <button
                            type="button"
                            className={`blocks-map-control__btn blocks-map-control__btn--action${actionLabel ? '' : ' blocks-map-control__btn--action-glyph'}`}
                            onClick={onActionClick}
                            title={actionName}
                            aria-label={actionName}
                        >
                            {actionIcon && <ActionIconMark icon={actionIcon} />}
                            {actionLabel && (
                                <span className="blocks-map-control__btn-label">{actionLabel}</span>
                            )}
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
