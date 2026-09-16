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

    // Action button — onActionClick is what makes it render
    /** Button text, doubling as its tooltip and accessible name. */
    actionLabel?: string
    /** Glyph drawn ahead of the label. */
    actionIcon?: ActionIcon
    onActionClick?: () => void

    /**
     * Optional element rendered after the bar's built-in controls and before
     * the action button (e.g. a share control). The bar only places it; look
     * and behavior belong to the host.
     */
    endSlot?: React.ReactNode
}

/** Sizes the glyph's box; both icon forms carry it, so both draw alike. */
const ACTION_ICON_CLASS = 'blocks-map-control__btn-icon'

/** Names a glyph-only button, the bar knowing nothing more about the action. */
const ACTION_FALLBACK_NAME = 'Action'

/**
 * The action button's glyph. An image is painted as a CSS mask, so it takes the
 * button's color through every state and an uploaded SVG is never parsed as a
 * document that could run script.
 */
function ActionIconMark({ icon }: { icon: ActionIcon }) {
    if (icon.kind === 'mdi')
        return (
            <i
                className={`${icon.className} ${ACTION_ICON_CLASS}`}
                aria-hidden="true"
            />
        )

    // The src sits inside a quoted url() in an inline style. Encoding what could
    // close that url holds the value to one url, unable to add declarations.
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

    // A glyph-only button carries no text, so it would otherwise go unnamed.
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
                {/* Built from the bar's __group and __btn classes, so it sits in
                    the row at their height. Only a labelled button claims the
                    row's free width; a glyph alone stays square. */}
                {onActionClick && (
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
