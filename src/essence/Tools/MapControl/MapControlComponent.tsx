import React, { useState, useRef, useEffect } from 'react'
import {
    BasemapStyle,
    GeocodeResult,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
    MEASURE_STYLE,
    basemapGradient,
    formatDistance,
    measureDistance,
    geocodeSearch,
} from './mapControlHelpers'
import './MapControlComponent.scss'

const MEASURE_OVERLAY_ID = 'plugin:mapcontrol:measure'
const SEARCH_DEBOUNCE_MS = 300

export interface MapControlComponentProps {
    /** Distance from the right edge of the map canvas (px). Dynamic — supplied by wrapper. */
    rightOffset?: number

    // Basemap
    basemapStyles?: BasemapStyle[]
    activeBasemap?: BasemapStyle | null
    onSelectBasemap?: (style: BasemapStyle) => void

    // Zoom
    onZoomIn?: () => void
    onZoomOut?: () => void

    // Measure — all three must be provided to enable the feature
    subscribeToMap?: (handlers: MapSubscribeHandlers) => () => void
    onDrawOverlay?: (opts: MapOverlayOpts) => void
    onRemoveOverlay?: (id: string) => void
    onProjectLatLng?: (latlng: LatLng) => Promise<{ x: number; y: number } | null>
    onSetCursor?: (cursor: string) => void

    // Geocode search
    onSearchSelect?: (result: GeocodeResult) => void
}

export function MapControlComponent({
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
}: MapControlComponentProps) {
    const rootRef = useRef<HTMLDivElement>(null)

    const [basemapOpen, setBasemapOpen] = useState(false)
    const [searchOpen, setSearchOpen]   = useState(false)
    const [measuring, setMeasuring]     = useState(false)
    const [points, setPoints]           = useState<LatLng[]>([])
    const [mouseLatLng, setMouseLatLng] = useState<LatLng | null>(null)
    const [labelPixel, setLabelPixel]   = useState<{ x: number; y: number } | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<GeocodeResult[]>([])
    const [searchLoading, setSearchLoading] = useState(false)

    const searchInputRef  = useRef<HTMLInputElement>(null)
    const searchTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

    const measureSupported = Boolean(subscribeToMap && onDrawOverlay && onRemoveOverlay)

    // Derived live segment for measure preview
    let segment: [LatLng, LatLng] | null = null
    if (measuring) {
        if (points.length === 2) segment = [points[0], points[1]]
        else if (points.length === 1 && mouseLatLng) segment = [points[0], mouseLatLng]
    }

    // ── Close panels on outside click ────────────────────────────────────────
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setBasemapOpen(false)
                setSearchOpen(false)
            }
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [])

    // ── Escape key ────────────────────────────────────────────────────────────
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return
            setBasemapOpen(false)
            setSearchOpen(false)
            if (measuring) {
                setMeasuring(false)
                setPoints([])
                setMouseLatLng(null)
                setLabelPixel(null)
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [measuring])

    // ── Auto-focus search input ───────────────────────────────────────────────
    useEffect(() => {
        if (searchOpen) searchInputRef.current?.focus()
        else { setSearchQuery(''); setSearchResults([]) }
    }, [searchOpen])

    // ── Debounced geocode search ───────────────────────────────────────────────
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        if (searchQuery.length < 2) { setSearchResults([]); setSearchLoading(false); return }
        setSearchLoading(true)
        searchTimerRef.current = setTimeout(async () => {
            const results = await geocodeSearch(searchQuery)
            setSearchResults(results)
            setSearchLoading(false)
        }, SEARCH_DEBOUNCE_MS)
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
    }, [searchQuery])

    // ── Map click/move subscription for measure ───────────────────────────────
    useEffect(() => {
        if (!measuring || !subscribeToMap) return
        const unsub = subscribeToMap({
            onClick: (e) => {
                if (e?.lat == null || e?.lng == null) return
                setPoints((prev) =>
                    prev.length >= 2 ? [{ lat: e.lat, lng: e.lng }] : [...prev, { lat: e.lat, lng: e.lng }]
                )
            },
            onMouseMove: (e) => {
                if (e?.lat != null && e?.lng != null) setMouseLatLng({ lat: e.lat, lng: e.lng })
            },
        })
        if (onSetCursor) onSetCursor('crosshair')
        return () => {
            unsub()
            if (onSetCursor) onSetCursor('')
        }
    }, [measuring, subscribeToMap, onSetCursor])

    // ── Draw measure overlay ──────────────────────────────────────────────────
    useEffect(() => {
        if (!onDrawOverlay || !onRemoveOverlay) return
        if (!measuring || points.length === 0) { onRemoveOverlay(MEASURE_OVERLAY_ID); return }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const features: any[] = points.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {},
        }))
        if (segment) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[segment[0].lng, segment[0].lat], [segment[1].lng, segment[1].lat]],
                },
                properties: {},
            })
        }
        onDrawOverlay({ id: MEASURE_OVERLAY_ID, geojson: { type: 'FeatureCollection', features }, style: MEASURE_STYLE })
        // mouseLatLng intentionally in deps — redraws preview line on every mouse move
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measuring, points, mouseLatLng, onDrawOverlay, onRemoveOverlay])

    // ── Cleanup overlay on unmount ─────────────────────────────────────────────
    useEffect(() => () => { onRemoveOverlay?.(MEASURE_OVERLAY_ID) }, [onRemoveOverlay])

    // ── Project segment midpoint → pixel for distance label ───────────────────
    useEffect(() => {
        if (!segment || !onProjectLatLng) { setLabelPixel(null); return }
        const mid = { lat: (segment[0].lat + segment[1].lat) / 2, lng: (segment[0].lng + segment[1].lng) / 2 }
        let cancelled = false
        Promise.resolve(onProjectLatLng(mid)).then((pt) => {
            if (!cancelled && pt?.x != null && pt?.y != null) setLabelPixel({ x: pt.x, y: pt.y })
        })
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segment?.[0]?.lat, segment?.[0]?.lng, segment?.[1]?.lat, segment?.[1]?.lng, onProjectLatLng])

    // ── Handlers ──────────────────────────────────────────────────────────────

    function toggleBasemap() { setBasemapOpen((v) => !v); setSearchOpen(false) }

    function toggleSearch() { setSearchOpen((v) => !v); setBasemapOpen(false) }

    function toggleMeasure() {
        if (measuring) {
            setMeasuring(false); setPoints([]); setMouseLatLng(null); setLabelPixel(null)
        } else {
            setMeasuring(true); setPoints([]); setBasemapOpen(false); setSearchOpen(false)
        }
    }

    function handleSearchSelect(result: GeocodeResult) {
        setSearchOpen(false)
        onSearchSelect?.(result)
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const current   = activeBasemap ?? (basemapStyles[0] ?? null)
    const hasStyles = basemapStyles.length > 0
    const hasZoom   = Boolean(onZoomIn && onZoomOut)

    return (
        <>
            <div ref={rootRef} className="map-control" style={{ right: rightOffset }}>
                {/* ── Toolbar (each feature is its own card) ── */}
                <div className="map-control__bar">
                    {onSearchSelect && (
                        <div className="map-control__group">
                            <button
                                type="button"
                                className={`map-control__btn${searchOpen ? ' map-control__btn--active' : ''}`}
                                onClick={toggleSearch}
                                title="Geocode search"
                                aria-expanded={searchOpen}
                            >
                                <SearchIcon />
                            </button>
                        </div>
                    )}
                    {hasStyles && (
                        <div className="map-control__group">
                            <button
                                type="button"
                                className={`map-control__btn${basemapOpen ? ' map-control__btn--active' : ''}`}
                                onClick={toggleBasemap}
                                title={current ? `Basemap: ${current.name}` : 'Basemap'}
                                aria-expanded={basemapOpen}
                            >
                                <BasemapIcon />
                            </button>
                        </div>
                    )}
                    {measureSupported && (
                        <div className="map-control__group">
                            <button
                                type="button"
                                className={`map-control__btn${measuring ? ' map-control__btn--active' : ''}`}
                                onClick={toggleMeasure}
                                title={measuring ? 'Exit measure mode (Esc)' : 'Measure distance'}
                            >
                                <RulerIcon />
                            </button>
                        </div>
                    )}
                    {hasZoom && (
                        <div className="map-control__group">
                            <button type="button" className="map-control__btn" onClick={onZoomOut} title="Zoom out">
                                <MinusIcon />
                            </button>
                            <span className="map-control__divider" />
                            <button type="button" className="map-control__btn" onClick={onZoomIn} title="Zoom in">
                                <PlusIcon />
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Basemap panel ── */}
                {basemapOpen && hasStyles && (
                    <div className="map-control__panel">
                        <div className="map-control__panel-header">Basemap style</div>
                        {basemapStyles.map((entry) => {
                            const isActive = current?.name === entry.name
                            return (
                                <button
                                    key={entry.name}
                                    type="button"
                                    className={`map-control__row${isActive ? ' map-control__row--active' : ''}`}
                                    onClick={() => { onSelectBasemap?.(entry); setBasemapOpen(false) }}
                                >
                                    <span className="map-control__row-label">{entry.name}</span>
                                    <span
                                        className={`map-control__row-thumb${isActive ? ' map-control__row-thumb--active' : ''}`}
                                        style={{ background: basemapGradient(entry.name) }}
                                    />
                                </button>
                            )
                        })}
                    </div>
                )}

                {/* ── Search panel ── */}
                {searchOpen && (
                    <div className="map-control__panel">
                        <div className="map-control__search-row">
                            <input
                                ref={searchInputRef}
                                type="search"
                                className="map-control__search-input"
                                placeholder="Search location…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        {searchLoading && <div className="map-control__search-hint">Searching…</div>}
                        {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
                            <div className="map-control__search-hint">No results</div>
                        )}
                        {searchResults.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                className="map-control__row"
                                onClick={() => handleSearchSelect(r)}
                            >
                                <span className="map-control__row-label">{r.displayName}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* ── Measure hint ── */}
                {measuring && points.length === 0 && (
                    <div className="map-control__hint">Click two points on the map</div>
                )}
            </div>

            {/* ── Distance label (positioned over map canvas) ── */}
            {measuring && segment && labelPixel && (
                <div
                    className="map-control__measure-label"
                    style={{ left: labelPixel.x, top: labelPixel.y }}
                >
                    {formatDistance(measureDistance(segment[0], segment[1]))}
                </div>
            )}
        </>
    )
}

// ─── Inline SVG icons (no icon-font dependency) ────────────────────────────

function Icon({ children }: { children: React.ReactNode }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {children}
        </svg>
    )
}
function BasemapIcon() { return <Icon><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></Icon> }
function SearchIcon()  { return <Icon><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></Icon> }
function RulerIcon()   { return <Icon><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z" /></Icon> }
function PlusIcon()    { return <Icon><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></Icon> }
function MinusIcon()   { return <Icon><path d="M19 13H5v-2h14v2z" /></Icon> }

export default MapControlComponent
