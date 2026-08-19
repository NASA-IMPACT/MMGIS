import {
    mmgisWriteCoordinateURL,
    mmgisGetMapScreenshot,
    mmgisGetViewState,
    mmgisCopyText,
    type MapScreenshotResult,
    type ViewState,
} from './mmgisAPI'
import { buildSharePdf, type JsPdfLike } from './sharePdf'
import { blobToDataUrl, downloadBlob } from './download'
import { composeExportImage } from './composeExportImage'
import { getExportLegendModel } from '../legend/getExportLegendModel'
import type { ExportLegendModel } from '../legend/getExportLegendModel'

// Orchestrates the three export actions, reaching core only through the
// shared mmgisAPI client. Dependencies are injectable for tests.

export const PNG_FILENAME = 'mmgis-map.png'
export const PDF_FILENAME = 'mmgis-map.pdf'

/**
 * Export filename per the core convention: mmgis-<mission>_<time>_<lat>_<lng>
 * .<ext>; unavailable fields are omitted, degrading to mmgis-map.<ext>.
 */
export function buildExportFilename(
    extension: string,
    viewState: ViewState | null,
): string {
    const parts: string[] = []
    if (viewState?.missionName) parts.push(viewState.missionName)
    if (viewState?.time) parts.push(viewState.time.split(':').join('-'))
    if (viewState?.center)
        parts.push(
            `${viewState.center.lat.toFixed(4)}_${viewState.center.lng.toFixed(
                4,
            )}`,
        )
    if (parts.length === 0) return `mmgis-map.${extension}`
    return `mmgis-${parts.join('_')}.${extension}`
}

export type CopyShareLinkDeps = {
    writeCoordinateURL?: () => Promise<string | null>
    copyText?: (text: string) => Promise<boolean>
}

/**
 * Copies the current view's self-contained share URL to the clipboard via
 * the shared client (core's app:copyText handler, with a browser-clipboard
 * fallback). Returns the copied URL. Throws if no link is available or the
 * copy fails.
 */
export async function copyShareLink(
    deps: CopyShareLinkDeps = {},
): Promise<string> {
    const {
        writeCoordinateURL = mmgisWriteCoordinateURL,
        copyText = mmgisCopyText,
    } = deps
    const url = await writeCoordinateURL()
    if (!url) throw new Error('No share link available')
    if (!(await copyText(url))) throw new Error('Clipboard copy failed')
    return url
}

export type LegendDeps = {
    includeLegend?: boolean
    getLegendModel?: () => Promise<ExportLegendModel>
    compose?: (
        screenshot: MapScreenshotResult,
        model: ExportLegendModel,
    ) => Promise<MapScreenshotResult>
}

// The export must never fail because the legend did — deliver the plain map
// and log, rather than surfacing a broken download.
async function applyLegend(
    screenshot: MapScreenshotResult,
    deps: LegendDeps,
): Promise<MapScreenshotResult> {
    const {
        includeLegend = true,
        getLegendModel = getExportLegendModel,
        compose = composeExportImage,
    } = deps
    if (!includeLegend) return screenshot
    try {
        return await compose(screenshot, await getLegendModel())
    } catch (err) {
        console.warn('Share export: legend omitted', err)
        return screenshot
    }
}

export type DownloadSharePngDeps = LegendDeps & {
    getScreenshot?: () => Promise<MapScreenshotResult | null>
    download?: (blob: Blob, filename: string) => void
    getViewState?: () => Promise<ViewState | null>
    filename?: string
}

/**
 * Downloads the current map as a PNG. Returns the composed screenshot result.
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
    const composed = await applyLegend(screenshot, deps)
    const filename =
        deps.filename ??
        buildExportFilename(composed.extension, await getViewState())
    download(composed.blob, filename)
    return composed
}

export type DownloadSharePdfDeps = LegendDeps & {
    getScreenshot?: () => Promise<MapScreenshotResult | null>
    blobToDataUrl?: (blob: Blob) => Promise<string>
    buildPdf?: (
        dataUrl: string,
        naturalWidth: number,
        naturalHeight: number,
    ) => JsPdfLike | Promise<JsPdfLike>
    getViewState?: () => Promise<ViewState | null>
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
    const composed = await applyLegend(screenshot, deps)
    const dataUrl = await convertBlobToDataUrl(composed.blob)
    const doc = await buildPdf(dataUrl, composed.width, composed.height)
    const filename =
        deps.filename ?? buildExportFilename('pdf', await getViewState())
    doc.save(filename)
    return doc
}
