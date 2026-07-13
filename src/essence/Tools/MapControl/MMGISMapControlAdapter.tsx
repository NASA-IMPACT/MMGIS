import React, { useCallback, useEffect, useState } from 'react'
import { MapControlBar } from './lib'
import type { BasemapStyle } from './lib'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
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

// Measures #topBarRight so the bar tucks beside the existing top-right chrome.
function useTopBarOffset(): number {
    const [offset, setOffset] = useState(12)
    useEffect(() => {
        const measure = () => {
            const el = document.getElementById('topBarRight')
            const w = el ? el.getBoundingClientRect().width : 0
            setOffset(w > 0 ? Math.ceil(w) + 16 : 12)
        }
        measure()
        const t = setTimeout(measure, 300)
        window.addEventListener('resize', measure)
        return () => {
            clearTimeout(t)
            window.removeEventListener('resize', measure)
        }
    }, [])
    return offset
}

export function MMGISMapControlAdapter() {
    const [basemapStyles, setBasemapStyles] = useState<BasemapStyle[]>([])
    const [activeBasemap, setActiveBasemap] = useState<BasemapStyle | null>(null)
    const rightOffset = useTopBarOffset()
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
            rightOffset={rightOffset}
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
