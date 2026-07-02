import {
    mmgisWriteCoordinateURL,
    mmgisGetMapScreenshot,
    type MapScreenshotResult,
} from '../../_shared/adapters/mmgisAPI'
import { buildSharePdf, type JsPdfLike } from './sharePdf'
import { blobToDataUrl, downloadBlob } from './download'

// Orchestrates the three export actions. Each function talks to core only
// through the shared mmgisAPI client (writeCoordinateURL / getMapScreenshot)
// and packages the result. Dependencies are injectable so the wiring is
// unit-testable without a live map or DOM.

export const PNG_FILENAME = 'mmgis-map.png'
export const PDF_FILENAME = 'mmgis-map.pdf'

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
        filename = PNG_FILENAME,
    } = deps
    const screenshot = await getScreenshot()
    if (!screenshot) throw new Error('No screenshot available')
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
    ) => JsPdfLike
    filename?: string
}

/**
 * Downloads the current map as a PDF: the PNG snapshot centered on a portrait
 * page. Returns the generated jsPDF document.
 */
export async function downloadSharePdf(
    deps: DownloadSharePdfDeps = {},
): Promise<JsPdfLike> {
    const {
        getScreenshot = mmgisGetMapScreenshot,
        blobToDataUrl: convertBlobToDataUrl = blobToDataUrl,
        buildPdf = buildSharePdf,
        filename = PDF_FILENAME,
    } = deps
    const screenshot = await getScreenshot()
    if (!screenshot) throw new Error('No screenshot available')
    const dataUrl = await convertBlobToDataUrl(screenshot.blob)
    const doc = buildPdf(dataUrl, screenshot.width, screenshot.height)
    doc.save(filename)
    return doc
}
