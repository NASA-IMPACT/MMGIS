import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapControlBar, resolveActionIcon } from './lib'
import type { ActionIcon, BasemapStyle } from './lib'
// The shared share-menu control (_shared/share) — same look
// and behaves identically wherever it's hosted. Importing the lib barrel also
// loads its (host-class-scoped) styles.
import { ShareMenu } from '../_shared/share'
import { resolveAction } from '../_shared/actions/resolveAction'
import { resolveIconClass } from '../_shared/content/iconClass'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { mmgisGetMissionPath } from '../_shared/adapters/mmgisAPI'
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
    actionButtonIconSource?: unknown
    actionButtonIconUpload?: unknown
    actionButtonIconUrl?: unknown
    actionButtonIconMdi?: unknown
}

const COPIED_RESET_MS = 1800

// What the action button says when the mission configured neither text nor an
// icon, so the control is never an empty box.
const ACTION_FALLBACK_LABEL = 'Analyze area'

const isFalsy = (v: unknown) =>
    v === false || v === 'false' || v === 0 || v === '0'

// Tool vars come from mission JSON, so any field may be any JSON type, and only
// a string is meaningful for these. Every other type — and a whitespace-only
// string — reads as unset rather than being coerced, so a mistyped value costs
// one feature rather than throwing through a bar that has no error boundary.
const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Points an uploaded icon at the file the mission actually serves. The upload
 * field stores a path relative to the mission directory
 * ("MapControl/uploads/<uuid>.svg"); an absolute or root-relative value is
 * already complete and passes through.
 */
function withResolvedIcon(
    icon: ActionIcon | null,
    missionPath: string | null
): ActionIcon | null {
    if (icon?.kind !== 'image') return icon
    if (/^(https?:|data:|\/)/i.test(icon.src)) return icon
    return { kind: 'image', src: (missionPath || '') + icon.src }
}

export function MMGISMapControlAdapter() {
    const [basemapStyles, setBasemapStyles] = useState<BasemapStyle[]>([])
    const [activeBasemap, setActiveBasemap] = useState<BasemapStyle | null>(null)
    const [shareBusy, setShareBusy] = useState(false)
    const [shareCopied, setShareCopied] = useState(false)
    const copiedTimer = useRef<number | null>(null)
    const vars = useMMGISToolVars<ToolVars>('mapcontrol')

    // Uploaded icons are stored mission-relative, so the bar needs the
    // mission's path before it can draw them.
    const [missionPath, setMissionPath] = useState<string | null>(null)
    const refreshMissionPath = useCallback(async () => {
        setMissionPath(await mmgisGetMissionPath())
    }, [])
    useMMGISHandlerReady('app:getMissionPath', refreshMissionPath)

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

    // The action button appears only for a mission that configured a link;
    // every other mission gets a bar without it.
    const actionLink = asText(vars.actionButtonLink)
    const actionText = asText(vars.actionButtonText)
    // Which of the icon fields a mission meant is the library's to work out;
    // which icon-font spellings it may write is core's, which is what
    // resolveIconClass is passed in for. Memoized because an unusable value
    // warns, and share and basemap state re-render this often.
    const actionIcon = useMemo(
        () =>
            withResolvedIcon(
                resolveActionIcon(
                    {
                        source: asText(vars.actionButtonIconSource),
                        upload: asText(vars.actionButtonIconUpload),
                        url: asText(vars.actionButtonIconUrl),
                        mdi: asText(vars.actionButtonIconMdi),
                    },
                    resolveIconClass
                ),
                missionPath
            ),
        [
            vars.actionButtonIconSource,
            vars.actionButtonIconUpload,
            vars.actionButtonIconUrl,
            vars.actionButtonIconMdi,
            missionPath,
        ]
    )

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
            // A configured glyph stands on its own, so only a button with
            // neither text nor icon falls back to generic wording.
            actionLabel={
                actionText || (actionIcon ? undefined : ACTION_FALLBACK_LABEL)
            }
            actionIcon={actionIcon ?? undefined}
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
