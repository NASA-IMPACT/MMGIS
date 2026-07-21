import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MapControlBar } from './lib'
import type { BasemapStyle } from './lib'
// ShareExport's portable share control — reused verbatim so the button looks
// and behaves identically wherever it's hosted. Importing the lib barrel also
// loads its (host-class-scoped) styles.
import { ShareMenu } from '../ShareExport/lib'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    copyShareLink,
    downloadSharePng,
    downloadSharePdf,
} from '../_shared/adapters/shareActions'
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
    showShare?: unknown
}

const COPIED_RESET_MS = 1800

const isFalsy = (v: unknown) =>
    v === false || v === 'false' || v === 0 || v === '0'

export function MMGISMapControlAdapter() {
    const [basemapStyles, setBasemapStyles] = useState<BasemapStyle[]>([])
    const [activeBasemap, setActiveBasemap] = useState<BasemapStyle | null>(null)
    const [shareBusy, setShareBusy] = useState(false)
    const [shareCopied, setShareCopied] = useState(false)
    const copiedTimer = useRef<number | null>(null)
    const vars = useMMGISToolVars<ToolVars>('mapcontrol')

    // Same handler pattern as MMGISShareExportAdapter, wired to the shared
    // share actions.
    useEffect(
        () => () => {
            if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
        },
        []
    )
    const handleCopyLink = useCallback(async () => {
        try {
            await copyShareLink()
            setShareCopied(true)
            if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
            copiedTimer.current = window.setTimeout(
                () => setShareCopied(false),
                COPIED_RESET_MS
            )
        } catch (err) {
            console.error('MapControl: copy link failed', err)
        }
    }, [])
    const handleDownloadPng = useCallback(async () => {
        setShareBusy(true)
        try {
            await downloadSharePng()
        } catch (err) {
            console.error('MapControl: PNG download failed', err)
        } finally {
            setShareBusy(false)
        }
    }, [])
    const handleDownloadPdf = useCallback(async () => {
        setShareBusy(true)
        try {
            await downloadSharePdf()
        } catch (err) {
            console.error('MapControl: PDF download failed', err)
        } finally {
            setShareBusy(false)
        }
    }, [])

    // Default ON; a saved false/0 disables the feature.
    const showBasemapSwitcher = !isFalsy(vars.showBasemapSwitcher)
    const showSearch = !isFalsy(vars.showSearch)
    const showMeasure = !isFalsy(vars.showMeasure)
    const showZoom = !isFalsy(vars.showZoom)
    const showShare = !isFalsy(vars.showShare)

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
            endSlot={
                showShare ? (
                    // shareExport-tool-host scopes the component's tokens;
                    // blocks-map-control__share restyles the trigger to the
                    // bar's dark button design.
                    <div className="shareExport-tool-host blocks-map-control__share">
                        <ShareMenu
                            formats={{ png: true, pdf: true }}
                            busy={shareBusy}
                            copied={shareCopied}
                            onCopyLink={handleCopyLink}
                            onDownloadPng={handleDownloadPng}
                            onDownloadPdf={handleDownloadPdf}
                        />
                    </div>
                ) : undefined
            }
        />
    )
}
