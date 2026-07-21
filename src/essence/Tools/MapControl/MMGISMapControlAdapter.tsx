import React, { useCallback, useState } from 'react'
import { MapControlBar } from './lib'
import type { BasemapStyle } from './lib'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { getBasemaps } from './adapters/getBasemaps'
import {
    selectBasemap,
    zoomIn,
    zoomOut,
    subscribeToMap,
    drawOverlay,
    removeOverlay,
    showMeasureLabel,
    removeMeasureLabel,
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

export function MMGISMapControlAdapter() {
    const [basemapStyles, setBasemapStyles] = useState<BasemapStyle[]>([])
    const [activeBasemap, setActiveBasemap] = useState<BasemapStyle | null>(null)
    const vars = useMMGISToolVars<ToolVars>('mapcontrol')

    // Default ON; a saved false/0 disables the feature.
    const showBasemapSwitcher = !isFalsy(vars.showBasemapSwitcher)
    const showSearch = !isFalsy(vars.showSearch)
    const showMeasure = !isFalsy(vars.showMeasure)
    const showZoom = !isFalsy(vars.showZoom)

    // Fetch once the map registers its basemap handlers. An empty style list
    // then means the mission genuinely has no basemap — not "not ready yet".
    const fetchBasemaps = useCallback(() => {
        getBasemaps().then(({ styles, active }) => {
            setBasemapStyles(styles)
            setActiveBasemap(active)
        })
    }, [])
    useMMGISHandlerReady('map:getBasemapStyles', fetchBasemaps)

    const onSelectBasemap = useCallback((style: BasemapStyle) => {
        setActiveBasemap(style)
        selectBasemap(style)
    }, [])

    return (
        <MapControlBar
            basemapStyles={showBasemapSwitcher ? basemapStyles : []}
            activeBasemap={showBasemapSwitcher ? activeBasemap : null}
            onSelectBasemap={showBasemapSwitcher ? onSelectBasemap : undefined}
            onZoomIn={showZoom ? zoomIn : undefined}
            onZoomOut={showZoom ? zoomOut : undefined}
            subscribeToMap={showMeasure ? subscribeToMap : undefined}
            onDrawOverlay={showMeasure ? drawOverlay : undefined}
            onRemoveOverlay={showMeasure ? removeOverlay : undefined}
            onShowMeasureLabel={showMeasure ? showMeasureLabel : undefined}
            onRemoveMeasureLabel={showMeasure ? removeMeasureLabel : undefined}
            onSetCursor={showMeasure ? setCursor : undefined}
            onSearchSelect={showSearch ? flyToResult : undefined}
        />
    )
}
