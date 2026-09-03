import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
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

    /**
     * Optional element rendered at the right end of the bar (e.g. a share
     * control). The bar only places it; look and behavior belong to the host.
     */
    endSlot?: React.ReactNode
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
