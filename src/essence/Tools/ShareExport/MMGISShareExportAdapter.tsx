import React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ShareMenu } from './lib'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    resolveShareFormats,
    type ShareToolVars,
    type ShareFormats,
} from './adapters/shareConfig'
import {
    copyShareLink,
    downloadSharePng,
    downloadSharePdf,
} from '../_shared/adapters/shareActions'

const PLUGIN_ID = 'shareexport'
const DEFAULT_FORMATS: ShareFormats = { png: true, pdf: true }
const COPIED_RESET_MS = 1800

/**
 * Bridges MMGIS to the portable <ShareMenu>. Reads the plugin's enabled-format
 * config over the mmgisAPI bus, and owns the three export effects (copy link,
 * download PNG, download PDF) — each delegating to the injectable, testable
 * action helpers, which in turn reach core only through the shared client.
 */
export function MMGISShareExportAdapter() {
    const [formats, setFormats] = useState<ShareFormats>(DEFAULT_FORMATS)
    const [busy, setBusy] = useState(false)
    const [copied, setCopied] = useState(false)
    const copiedTimer = useRef<number | null>(null)

    const refresh = useCallback(async () => {
        try {
            const vars = await mmgisRequest<ShareToolVars>(
                'tool:getVars',
                PLUGIN_ID,
            )
            setFormats(resolveShareFormats(vars))
        } catch (err) {
            console.error('ShareExport: refresh failed', err)
        }
    }, [])

    // 'tool:getVars' is registered by Layers_.fina() during mission load. Wait
    // for it before the initial fetch, otherwise the panel mounts to defaults
    // and never recovers (no event fires when vars first become available).
    useMMGISHandlerReady('tool:getVars', refresh)

    // Clear the pending "copied" reset timer on unmount so it can't call
    // setCopied on an unmounted tree (the panel can be destroyed within the
    // reset window).
    useEffect(
        () => () => {
            if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
        },
        [],
    )

    const handleCopyLink = useCallback(async () => {
        try {
            await copyShareLink()
            setCopied(true)
            if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
            copiedTimer.current = window.setTimeout(
                () => setCopied(false),
                COPIED_RESET_MS,
            )
        } catch (err) {
            console.error('ShareExport: copy link failed', err)
        }
    }, [])

    const handleDownloadPng = useCallback(async () => {
        setBusy(true)
        try {
            await downloadSharePng()
        } catch (err) {
            console.error('ShareExport: PNG download failed', err)
        } finally {
            setBusy(false)
        }
    }, [])

    const handleDownloadPdf = useCallback(async () => {
        setBusy(true)
        try {
            await downloadSharePdf()
        } catch (err) {
            console.error('ShareExport: PDF download failed', err)
        } finally {
            setBusy(false)
        }
    }, [])

    return (
        <ShareMenu
            formats={formats}
            busy={busy}
            copied={copied}
            onCopyLink={handleCopyLink}
            onDownloadPng={handleDownloadPng}
            onDownloadPdf={handleDownloadPdf}
        />
    )
}
