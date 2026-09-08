import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MapControlBar } from './lib'
import type { BasemapStyle } from './lib'
// The shared share-menu control (_shared/share) — same look
// and behaves identically wherever it's hosted. Importing the lib barrel also
// loads its (host-class-scoped) styles.
import { ShareMenu } from '../_shared/share'
import { resolveAction } from '../_shared/actions/resolveAction'
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
    actionButtonText?: unknown
    actionButtonLink?: unknown
    actionButtonIcon?: unknown
}

const COPIED_RESET_MS = 1800

const isFalsy = (v: unknown) =>
    v === false || v === 'false' || v === 0 || v === '0'

// Tool vars are the raw `variables` object out of mission JSON, so every field
// arrives unvalidated and may be any JSON type — which is why they are typed
// `unknown` here. Calling a string method straight on one of them throws during
// render, and MapControlTool mounts this adapter without an error boundary, so
// a single mistyped value would take the whole control bar down with it: no
// search, no basemaps, no measure, no zoom, no share.
//
// Only a string is meaningful for any of these fields: an action is a URL, a
// namespaced core request or an event name, an icon is an mdi class, and a
// label is display text. Every other JSON type reads as unset rather than
// being coerced, so a number never becomes an event named '0' and an object
// never becomes one named '[object Object]'. Trimming makes a whitespace-only
// value read as unset too.
const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

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

    // The action button defaults OFF, so it deliberately skips isFalsy: only a
    // mission that configured a link gets one, and every other mission gets a
    // bar without it.
    const actionLink = asText(vars.actionButtonLink)
    const actionText = asText(vars.actionButtonText)
    const actionIcon = asText(vars.actionButtonIcon)

    // What the link means — an external URL, a panel/plugin request, a custom
    // event — is resolveAction's business; the adapter only forwards it.
    const handleActionClick = useCallback(() => {
        resolveAction(actionLink)
    }, [actionLink])

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
            // A blank label leaves the prop unset so the bar applies its own
            // default text, keeping that string in one place.
            actionLabel={actionText || undefined}
            // Leaving the icon unset when none is configured is what tells the
            // bar it may not collapse the button down to a glyph, since there
            // would be nothing left to identify the action by.
            actionIcon={actionIcon || undefined}
            onActionClick={actionLink ? handleActionClick : undefined}
            endSlot={
                showShare ? (
                    // shareExport-tool-host scopes the component's tokens, which
                    // is where the trigger's grey glyph comes from;
                    // blocks-map-control__share gives it the bar's icon-button
                    // surface — white, square-cornered and held to the bar's
                    // button size — so it sits alongside the bar's other icon
                    // buttons.
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
