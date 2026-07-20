import React, { useCallback, useEffect, useState } from 'react'
import { MapControlBar } from './lib'
import type { BasemapStyle } from './lib'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { getBasemaps } from './adapters/getBasemaps'
import {
    selectBasemap,
    zoomIn,
    zoomOut,
    subscribeToMap,
    drawOverlay,
    removeOverlay,
    projectLatLng,
    setCursor,
    flyToResult,
} from './adapters/handlers'

type ToolVars = {
    showBasemapSwitcher?: unknown
    showSearch?: unknown
    showMeasure?: unknown
    showZoom?: unknown
}

const isFalsy = (v: unknown) =>
    v === false || v === 'false' || v === 0 || v === '0'

// The measure label anchors to map-container-relative pixel coords, so it
// must portal onto the live map element rather than render inside the panel.
const MAP_CONTAINER_IDS = ['mapScreen', 'map']

const getMapContainer = (): HTMLElement | null => {
    for (const id of MAP_CONTAINER_IDS) {
        const el = document.getElementById(id)
        if (el) return el
    }
    return null
}

export function MMGISMapControlAdapter() {
    const [basemapStyles, setBasemapStyles] = useState<BasemapStyle[]>([])
    const [activeBasemap, setActiveBasemap] = useState<BasemapStyle | null>(null)
    const vars = useMMGISToolVars<ToolVars>('mapcontrol')

    // Default ON; a saved false/0 disables the feature.
    const showBasemapSwitcher = !isFalsy(vars.showBasemapSwitcher)
    const showSearch = !isFalsy(vars.showSearch)
    const showMeasure = !isFalsy(vars.showMeasure)
    const showZoom = !isFalsy(vars.showZoom)

    // Retry until the map registers its basemap handlers (fixes the
    // "switcher appears only sometimes" race).
    useEffect(() => {
        let cancelled = false
        let attempts = 0
        const tick = () => {
            if (cancelled || attempts >= 20) return
            attempts++
            getBasemaps()
                .then(({ styles, active }) => {
                    if (cancelled) return
                    if (styles.length === 0) {
                        setTimeout(tick, 300)
                        return
                    }
                    setBasemapStyles(styles)
                    setActiveBasemap(active)
                })
                .catch(() => {
                    if (!cancelled) setTimeout(tick, 300)
                })
        }
        tick()
        return () => {
            cancelled = true
        }
    }, [])

    const onSelectBasemap = useCallback((style: BasemapStyle) => {
        setActiveBasemap(style)
        selectBasemap(style)
    }, [])

    return (
        <MapControlBar
            getOverlayContainer={getMapContainer}
            basemapStyles={showBasemapSwitcher ? basemapStyles : []}
            activeBasemap={showBasemapSwitcher ? activeBasemap : null}
            onSelectBasemap={showBasemapSwitcher ? onSelectBasemap : undefined}
            onZoomIn={showZoom ? zoomIn : undefined}
            onZoomOut={showZoom ? zoomOut : undefined}
            subscribeToMap={showMeasure ? subscribeToMap : undefined}
            onDrawOverlay={showMeasure ? drawOverlay : undefined}
            onRemoveOverlay={showMeasure ? removeOverlay : undefined}
            onProjectLatLng={showMeasure ? projectLatLng : undefined}
            onSetCursor={showMeasure ? setCursor : undefined}
            onSearchSelect={showSearch ? flyToResult : undefined}
        />
    )
}
