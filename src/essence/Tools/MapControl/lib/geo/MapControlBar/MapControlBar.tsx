import React, { useEffect, useRef, useState } from 'react'
import type {
    BasemapStyle,
    ContainerPoint,
    GeocodeResult,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
} from '../../types'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch'
import { useMeasure } from '../../hooks/useMeasure'
import { BasemapPanel } from '../BasemapPanel/BasemapPanel'
import { SearchPanel } from '../SearchPanel/SearchPanel'
import { MeasureLabel } from '../MeasureLabel/MeasureLabel'
import { BasemapIcon, MinusIcon, PlusIcon, RulerIcon, SearchIcon } from '../icons'

export type MapControlBarProps = {
    /** Distance from the right edge of the viewport (px) — dynamic, from the wrapper. */
    rightOffset?: number

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
    onProjectLatLng?: (latlng: LatLng) => Promise<ContainerPoint | null>
    onSetCursor?: (cursor: string) => void

    // Geocode search
    onSearchSelect?: (result: GeocodeResult) => void
}

export function MapControlBar({
    rightOffset = 12,
    basemapStyles = [],
    activeBasemap = null,
    onSelectBasemap,
    onZoomIn,
    onZoomOut,
    subscribeToMap,
    onDrawOverlay,
    onRemoveOverlay,
    onProjectLatLng,
    onSetCursor,
    onSearchSelect,
}: MapControlBarProps) {
    const rootRef = useRef<HTMLDivElement>(null)
    const [basemapOpen, setBasemapOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const measure = useMeasure({
        subscribeToMap,
        onDrawOverlay,
        onRemoveOverlay,
        onProjectLatLng,
        onSetCursor,
    })
    const { results, loading } = useDebouncedSearch(searchOpen ? searchQuery : '')

    useOutsideClick(rootRef, () => {
        setBasemapOpen(false)
        setSearchOpen(false)
    })

    // Escape closes panels and exits measure mode
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return
            setBasemapOpen(false)
            setSearchOpen(false)
            measure.stop()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [measure.stop])

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
        <>
            <div ref={rootRef} className="blocks-map-control" style={{ right: rightOffset }}>
                <div className="blocks-map-control__bar">
                    {onSearchSelect && (
                        <div className="blocks-map-control__group">
                            <button
                                type="button"
                                className={`blocks-map-control__btn${searchOpen ? ' blocks-map-control__btn--active' : ''}`}
                                onClick={toggleSearch}
                                title="Geocode search"
                                aria-expanded={searchOpen}
                            >
                                <SearchIcon />
                            </button>
                        </div>
                    )}
                    {hasStyles && (
                        <div className="blocks-map-control__group">
                            <button
                                type="button"
                                className={`blocks-map-control__btn${basemapOpen ? ' blocks-map-control__btn--active' : ''}`}
                                onClick={toggleBasemap}
                                title={current ? `Basemap: ${current.name}` : 'Basemap'}
                                aria-expanded={basemapOpen}
                            >
                                <BasemapIcon />
                            </button>
                        </div>
                    )}
                    {measure.supported && (
                        <div className="blocks-map-control__group">
                            <button
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
                        <div className="blocks-map-control__group">
                            <button type="button" className="blocks-map-control__btn" onClick={onZoomOut} title="Zoom out">
                                <MinusIcon />
                            </button>
                            <span className="blocks-map-control__divider" />
                            <button type="button" className="blocks-map-control__btn" onClick={onZoomIn} title="Zoom in">
                                <PlusIcon />
                            </button>
                        </div>
                    )}
                </div>

                {basemapOpen && hasStyles && (
                    <BasemapPanel
                        styles={basemapStyles}
                        active={current}
                        onSelect={(entry) => {
                            onSelectBasemap?.(entry)
                            setBasemapOpen(false)
                        }}
                    />
                )}

                {searchOpen && (
                    <SearchPanel
                        query={searchQuery}
                        results={results}
                        loading={loading}
                        onQueryChange={setSearchQuery}
                        onSelect={handleSearchSelect}
                    />
                )}

                {measure.awaitingFirst && (
                    <div className="blocks-map-control__hint">Click two points on the map</div>
                )}
            </div>

            {measure.measuring && measure.segment && measure.labelPixel && (
                <MeasureLabel segment={measure.segment} pixel={measure.labelPixel} />
            )}
        </>
    )
}
