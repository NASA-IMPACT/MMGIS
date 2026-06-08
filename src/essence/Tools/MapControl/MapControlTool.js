/**
 * MapControlTool — MMGIS plugin wrapper for MapControlComponent.
 *
 * Bus channels consumed (request):
 *   map:getBasemapStyles  map:getBasemap  map:setBasemap
 *   map:zoomIn            map:zoomOut
 *   map:fitBounds         map:latLngToContainerPoint
 *   map:createLayer       map:removeLayer   (provided by PR #90 imapengine-drawing)
 *
 * Bus channels consumed (on / subscribe):
 *   map:click             map:mousemove
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { MapControlComponent } from './MapControlComponent'

const ROOT_ID    = 'mmgis-map-control-root'
// position:fixed anchors to the viewport regardless of which UI layout is
// active (Modern UI's #modern-content is emptied on re-render; Default UI uses
// #mapScreen). Mounting into document.body is the simplest, safest anchor.
const ROOT_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:1002;'
const TOP_BAR_ID = 'topBarRight'
const SEARCH_OVERLAY_ID = 'plugin:mapcontrol:search'

// Set cursor on the actual Leaflet map canvas.
const MAP_CURSOR_IDS = ['mapScreen', 'map']
function _getMapCursorEl() {
    for (const id of MAP_CURSOR_IDS) {
        const el = document.getElementById(id)
        if (el) return el
    }
    return null
}

// Poll for app readiness — any of these elements means the map is alive.
const APP_READY_IDS = ['mapScreen', 'modern-content', 'map']
function _isAppReady() {
    return APP_READY_IDS.some((id) => document.getElementById(id) !== null)
}

// ─── Top-bar offset hook ──────────────────────────────────────────────────────
// Measures #topBarRight so the bar never overlaps the top-right chrome.

function useTopBarOffset() {
    const [offset, setOffset] = useState(12)
    useEffect(() => {
        function measure() {
            const el = document.getElementById(TOP_BAR_ID)
            const w  = el ? el.getBoundingClientRect().width : 0
            setOffset(w > 0 ? Math.ceil(w) + 16 : 12)
        }
        measure()
        const t = setTimeout(measure, 300)
        window.addEventListener('resize', measure)
        return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
    }, [])
    return offset
}

// ─── ConnectedMapControl ──────────────────────────────────────────────────────
// Translates MMGIS event-bus calls into plain props for MapControlComponent.

// Default feature flags — all on. Overridden by mission tool variables.
const DEFAULT_FEATURES = {
    showBasemapSwitcher: true,
    showSearch: true,
    showMeasure: true,
    showZoom: true,
}

function isFalsy(v) {
    return v === false || v === 'false' || v === 0 || v === '0'
}

function useToolFeatures() {
    const [features, setFeatures] = useState(DEFAULT_FEATURES)
    useEffect(() => {
        let cancelled = false
        let attempts = 0
        const MAX = 20

        function tryFetch() {
            if (cancelled || attempts >= MAX) return
            attempts++
            const api = window.mmgisAPI
            if (!api) { setTimeout(tryFetch, 300); return }
            // getToolVars lowercases the name internally
            api.request('tool:getVars', 'mapcontrol')
                .then((vars) => {
                    if (cancelled) return
                    // __noVars means the tool has no saved variables — keep defaults
                    if (!vars || vars.__noVars) return
                    setFeatures({
                        showBasemapSwitcher: !isFalsy(vars.showBasemapSwitcher),
                        showSearch:          !isFalsy(vars.showSearch),
                        showMeasure:         !isFalsy(vars.showMeasure),
                        showZoom:            !isFalsy(vars.showZoom),
                    })
                })
                .catch(() => {
                    if (!cancelled) setTimeout(tryFetch, 300)
                })
        }

        tryFetch()
        return () => { cancelled = true }
    }, [])
    return features
}

function ConnectedMapControl() {
    const [basemapStyles, setBasemapStyles] = useState([])
    const [activeBasemap, setActiveBasemap] = useState(null)
    const rightOffset = useTopBarOffset()
    const features = useToolFeatures()

    useEffect(() => {
        let cancelled = false
        let attempts = 0
        const MAX_ATTEMPTS = 20 // 20 × 300 ms = 6 s max

        function tryFetch() {
            if (cancelled || attempts >= MAX_ATTEMPTS) return
            attempts++
            const api = window.mmgisAPI
            if (!api) { setTimeout(tryFetch, 300); return }
            Promise.all([
                api.request('map:getBasemapStyles'),
                api.request('map:getBasemap'),
            ]).then(([styles, active]) => {
                if (cancelled) return
                const s = styles || []
                // Handler not yet registered or map not ready — retry
                if (s.length === 0) { setTimeout(tryFetch, 300); return }
                setBasemapStyles(s)
                setActiveBasemap(active || s[0] || null)
            }).catch(() => {
                if (!cancelled) setTimeout(tryFetch, 300)
            })
        }

        tryFetch()
        return () => { cancelled = true }
    }, [])

    const onSelectBasemap = useCallback((style) => {
        setActiveBasemap(style)
        window.mmgisAPI?.request('map:setBasemap', style.name)
    }, [])

    const onZoomIn  = useCallback(() => { window.mmgisAPI?.request('map:zoomIn')  }, [])
    const onZoomOut = useCallback(() => { window.mmgisAPI?.request('map:zoomOut') }, [])

    const subscribeToMap = useCallback(({ onClick, onMouseMove }) => {
        const api = window.mmgisAPI
        if (!api?.on) return () => {}
        const offClick = api.on('map:click',     onClick)
        const offMove  = api.on('map:mousemove', onMouseMove)
        return () => {
            if (typeof offClick === 'function') offClick()
            if (typeof offMove  === 'function') offMove()
        }
    }, [])

    // Vector overlays go through map:createLayer / map:removeLayer (provided by
    // the imapengine-drawing PR #90). We render ephemeral vector geometry, so we
    // use the generic layer CRUD rather than #90's map:addOverlay, which is a
    // DOM-element-at-a-point overlay with a different contract.
    // Guard: only call removeLayer if the layer was actually drawn.
    const overlayExistsRef = useRef(false)
    const onDrawOverlay = useCallback(({ id, geojson, style }) => {
        overlayExistsRef.current = true
        window.mmgisAPI?.request('map:createLayer', {
            id,
            type: 'vector',
            geojson,
            style,
            interactive: false,
        })
    }, [])
    const onRemoveOverlay = useCallback((id) => {
        if (!overlayExistsRef.current) return
        overlayExistsRef.current = false
        window.mmgisAPI?.request('map:removeLayer', { id }).catch(() => {})
    }, [])

    const onProjectLatLng = useCallback((latlng) => {
        if (!window.mmgisAPI) return Promise.resolve(null)
        return window.mmgisAPI.request('map:latLngToContainerPoint', latlng).catch(() => null)
    }, [])

    const onSetCursor = useCallback((cursor) => {
        const el = _getMapCursorEl()
        if (el) el.style.cursor = cursor
    }, [])

    const onSearchSelect = useCallback((result) => {
        const api = window.mmgisAPI
        if (!api) return
        // Nominatim bbox: [min_lat, max_lat, min_lon, max_lon]
        // map:fitBounds expects [[south, west], [north, east]]
        api.request('map:fitBounds', [
            [result.bbox[0], result.bbox[2]],
            [result.bbox[1], result.bbox[3]],
        ])
        api.request('map:createLayer', {
            id: SEARCH_OVERLAY_ID,
            type: 'vector',
            interactive: false,
            geojson: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [result.lng, result.lat] },
                    properties: {},
                }],
            },
            style: { color: '#005ea2', fillColor: '#005ea2', fillOpacity: 0.85, radius: 7, weight: 2 },
        })
    }, [])

    return (
        <MapControlComponent
            rightOffset={rightOffset}
            basemapStyles={features.showBasemapSwitcher ? basemapStyles : []}
            activeBasemap={features.showBasemapSwitcher ? activeBasemap : null}
            onSelectBasemap={features.showBasemapSwitcher ? onSelectBasemap : undefined}
            onZoomIn={features.showZoom ? onZoomIn : undefined}
            onZoomOut={features.showZoom ? onZoomOut : undefined}
            subscribeToMap={features.showMeasure ? subscribeToMap : undefined}
            onDrawOverlay={features.showMeasure ? onDrawOverlay : undefined}
            onRemoveOverlay={features.showMeasure ? onRemoveOverlay : undefined}
            onProjectLatLng={features.showMeasure ? onProjectLatLng : undefined}
            onSetCursor={features.showMeasure ? onSetCursor : undefined}
            onSearchSelect={features.showSearch ? onSearchSelect : undefined}
        />
    )
}

// ─── InterfaceWithMMGIS ───────────────────────────────────────────────────────
// Mounts the React overlay into document.body with position:fixed so it is
// immune to any parent container being emptied or repositioned.

function InterfaceWithMMGIS() {
    document.getElementById(ROOT_ID)?.remove()

    const container = document.createElement('div')
    container.id = ROOT_ID
    container.style.cssText = ROOT_STYLE
    document.body.appendChild(container)

    const root = createRoot(container)
    root.render(<ConnectedMapControl />)

    this.separateFromMMGIS = () => {
        root.unmount()
        container.remove()
    }
}

// ─── MapControlTool (MMGIS plugin contract) ───────────────────────────────────

const MapControlTool = {
    height: 0,
    width: 0,
    MMGISInterface: null,
    made: false,

    make() {
        if (this.MMGISInterface) return
        this.MMGISInterface = new InterfaceWithMMGIS()
        this.made = true
    },

    destroy() {
        if (this.MMGISInterface) this.MMGISInterface.separateFromMMGIS()
        this.MMGISInterface = null
        this.made = false
    },

    getUrlString() { return '' },
}

// ─── Module-level auto-mount ──────────────────────────────────────────────────
// src/pre/tools.js eagerly imports every tool at app start (before any DOM
// exists). Poll until the map is alive (#mapScreen / #modern-content / #map),
// then mount. The MMGISInterface guard prevents double-mounting if make() is
// later called by the panel system.

function _tryAutoMount() {
    if (MapControlTool.MMGISInterface) return true
    if (!_isAppReady()) return false
    MapControlTool.make()
    return true
}

if (typeof window !== 'undefined') {
    if (!_tryAutoMount()) {
        const _id = setInterval(() => { if (_tryAutoMount()) clearInterval(_id) }, 100)
        setTimeout(() => clearInterval(_id), 15000)
    }
}

export default MapControlTool
