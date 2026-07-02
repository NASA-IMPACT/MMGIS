import {
    mmgisWriteCoordinateURL,
    mmgisGetMapScreenshot,
    mmgisGetViewState,
    type MapScreenshotResult,
    type ViewState,
} from '../../_shared/adapters/mmgisAPI'
import { buildSharePdf, type JsPdfLike } from './sharePdf'
import { blobToDataUrl, downloadBlob } from './download'

// Orchestrates the three export actions. Each function talks to core only
// through the shared mmgisAPI client (writeCoordinateURL / getMapScreenshot /
// getViewState) and packages the result. Dependencies are injectable so the
// wiring is unit-testable without a live map or DOM.

export const PNG_FILENAME = 'mmgis-map.png'
export const PDF_FILENAME = 'mmgis-map.pdf'

/**
 * Builds a provenance-rich export filename matching the core screenshot
 * button's convention: mmgis-<mission>_<time>_<lat>_<lng>.<ext>. Fields the
 * view can't answer yet are omitted; with no view state at all this degrades
 * to the generic mmgis-map.<ext>.
 */
export function buildExportFilename(
    extension: string,
    viewState: ViewState | null,
): string {
    const parts: string[] = []
    if (viewState?.missionName) parts.push(viewState.missionName)
    if (viewState?.time) parts.push(viewState.time.replaceAll(':', '-'))
    if (viewState?.center)
        parts.push(
            `${viewState.center.lat.toFixed(4)}_${viewState.center.lng.toFixed(
                4,
            )}`,
        )
    if (parts.length === 0) return `mmgis-map.${extension}`
    return `mmgis-${parts.join('_')}.${extension}`
}

// navigator / document are injectable so the dual clipboard paths can be
// exercised in tests (Node's global navigator is read-only and can't be
// monkeypatched).
export type ClipboardEnv = {
    nav?: { clipboard?: { writeText?: (text: string) => Promise<void> } }
    doc?: Document
}

/**
 * Writes text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden-textarea + execCommand('copy') when it is unavailable.
 *
 * navigator.clipboard is undefined on insecure origins (e.g. HTTP served by IP,
 * not localhost), so the modern path silently doesn't exist there. Failures in
 * either path surface as a thrown error so the caller can react.
 */
export async function writeTextToClipboard(
    text: string,
    env: ClipboardEnv = {},
): Promise<void> {
    const nav =
        env.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
    const doc =
        env.doc ?? (typeof document !== 'undefined' ? document : undefined)

    if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text)
        return
    }
    // Legacy fallback for insecure origins / older browsers.
    if (!doc) throw new Error('Clipboard is unavailable')
    const textarea = doc.createElement('textarea')
    textarea.value = text
    // Keep it off-screen and non-disruptive while still selectable.
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    textarea.setAttribute('readonly', '')
    doc.body.appendChild(textarea)
    try {
        textarea.select()
        const ok = doc.execCommand('copy')
        if (!ok) throw new Error('Clipboard copy command was rejected')
    } finally {
        doc.body.removeChild(textarea)
    }
}

export type CopyShareLinkDeps = {
    writeCoordinateURL?: () => string | null
    writeClipboard?: (text: string) => Promise<void>
}

/**
 * Copies the current view's self-contained share URL to the clipboard.
 * Returns the copied URL. Throws if no link is available or the copy fails.
 */
export async function copyShareLink(
    deps: CopyShareLinkDeps = {},
): Promise<string> {
    const {
        writeCoordinateURL = mmgisWriteCoordinateURL,
        writeClipboard = writeTextToClipboard,
    } = deps
    const url = writeCoordinateURL()
    if (!url) throw new Error('No share link available')
    await writeClipboard(url)
    return url
}

export type DownloadSharePngDeps = {
    getScreenshot?: () => Promise<MapScreenshotResult | null>
    download?: (blob: Blob, filename: string) => void
    getViewState?: () => ViewState | null
    filename?: string
}

/**
 * Downloads the current map as a PNG. Returns the screenshot result.
 */
export async function downloadSharePng(
    deps: DownloadSharePngDeps = {},
): Promise<MapScreenshotResult> {
    const {
        getScreenshot = mmgisGetMapScreenshot,
        download = downloadBlob,
        getViewState = mmgisGetViewState,
    } = deps
    const screenshot = await getScreenshot()
    if (!screenshot) throw new Error('No screenshot available')
    const filename =
        deps.filename ??
        buildExportFilename(screenshot.extension, getViewState())
    download(screenshot.blob, filename)
    return screenshot
}

export type DownloadSharePdfDeps = {
    getScreenshot?: () => Promise<MapScreenshotResult | null>
    blobToDataUrl?: (blob: Blob) => Promise<string>
    buildPdf?: (
        dataUrl: string,
        naturalWidth: number,
        naturalHeight: number,
    ) => JsPdfLike | Promise<JsPdfLike>
    getViewState?: () => ViewState | null
    filename?: string
}

/**
 * Downloads the current map as a PDF: the PNG snapshot centered on a portrait
 * page. Returns the generated jsPDF document. buildPdf is awaited because the
 * default lazy-loads jspdf via a code-split dynamic import.
 */
export async function downloadSharePdf(
    deps: DownloadSharePdfDeps = {},
): Promise<JsPdfLike> {
    const {
        getScreenshot = mmgisGetMapScreenshot,
        blobToDataUrl: convertBlobToDataUrl = blobToDataUrl,
        buildPdf = buildSharePdf,
        getViewState = mmgisGetViewState,
    } = deps
    const screenshot = await getScreenshot()
    if (!screenshot) throw new Error('No screenshot available')
    const dataUrl = await convertBlobToDataUrl(screenshot.blob)
    const doc = await buildPdf(dataUrl, screenshot.width, screenshot.height)
    const filename =
        deps.filename ?? buildExportFilename('pdf', getViewState())
    doc.save(filename)
    return doc
}
