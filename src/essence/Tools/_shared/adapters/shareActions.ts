import {
    mmgisWriteCoordinateURL,
    mmgisGetMapScreenshot,
    mmgisGetViewState,
    mmgisCopyText,
    mmgisGetScaleBarSettings,
    type ClientPoint,
    type MapScreenshotResult,
    type ScaleBarSettings,
    type ViewState,
} from './mmgisAPI'
import { buildSharePdf, type JsPdfLike } from './sharePdf'
import { blobToDataUrl, downloadBlob } from './download'
import {
    composeExportImage,
    type ComposeDeps,
    type ExportScaleBar,
} from '../legend/composeExportImage'
import {
    getExportLegendModel,
    type ExportLegendModel,
} from '../legend/getExportLegendModel'

// Orchestrates the three export actions, reaching core only through the
// shared mmgisAPI client. Dependencies are injectable for tests.

export const PNG_FILENAME = 'map.png'
export const PDF_FILENAME = 'map.pdf'

/**
 * Export filename per the core convention: <mission>_<time>_<lat>_<lng>
 * .<ext>; unavailable fields are omitted, degrading to map.<ext>.
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
    if (parts.length === 0) return `map.${extension}`
    return `${parts.join('_')}.${extension}`
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

export type DecorationDeps = {
    includeLegend?: boolean
    getLegendModel?: () => Promise<ExportLegendModel>
    getScaleBarSettings?: () => Promise<ScaleBarSettings | null>
    compose?: (
        screenshot: MapScreenshotResult,
        model: ExportLegendModel | null,
        deps?: ComposeDeps,
    ) => Promise<MapScreenshotResult>
}

type GetScreenshot = (options?: {
    scaleAt?: ClientPoint
}) => Promise<MapScreenshotResult | null>

async function readScaleBarSettings(
    getScaleBarSettings: () => Promise<ScaleBarSettings | null>,
): Promise<ScaleBarSettings | null> {
    try {
        return await getScaleBarSettings()
    } catch (err) {
        console.warn('Share export: scale bar omitted', err)
        return null
    }
}

// Uses the capture's own scale, which is in image pixels and of that exact
// view, measured where the on-screen bar sits when the capture was given it.
// A tilted or continent-wide view has no scale by design, so a capture
// without one is not logged; the capture logs a failure to measure itself.
function resolveExportScaleBar(
    screenshot: MapScreenshotResult,
    settings: ScaleBarSettings | null,
): ExportScaleBar | null {
    if (!settings) return null
    const { metersPerPixel, scaleAnchor } = screenshot
    if (typeof metersPerPixel !== 'number' || !(metersPerPixel > 0)) return null
    return {
        metersPerPixel,
        units: settings.units,
        ...(scaleAnchor ? { anchor: scaleAnchor } : {}),
    }
}

// The export must never fail because a decoration did — deliver what can be
// drawn and log the rest, rather than surfacing a broken download.
async function applyDecorations(
    screenshot: MapScreenshotResult,
    settings: ScaleBarSettings | null,
    deps: DecorationDeps,
): Promise<MapScreenshotResult> {
    const {
        includeLegend = true,
        getLegendModel = getExportLegendModel,
        compose = composeExportImage,
    } = deps
    const scaleBar = resolveExportScaleBar(screenshot, settings)
    let model: ExportLegendModel | null = null
    if (includeLegend) {
        try {
            model = await getLegendModel()
        } catch (err) {
            console.warn('Share export: legend omitted', err)
        }
    }
    if (!model && !scaleBar) return screenshot
    try {
        return await compose(screenshot, model, { scaleBar })
    } catch (err) {
        console.warn('Share export: legend and scale bar omitted', err)
        return screenshot
    }
}

// The ScaleBar plugin's settings are read before the capture, so the capture
// measures the scale where the on-screen bar sits.
async function captureDecorated(
    getScreenshot: GetScreenshot,
    deps: DecorationDeps,
): Promise<MapScreenshotResult> {
    const settings = await readScaleBarSettings(
        deps.getScaleBarSettings ?? mmgisGetScaleBarSettings,
    )
    const screenshot = await getScreenshot(
        settings?.at ? { scaleAt: settings.at } : undefined,
    )
    if (!screenshot) throw new Error('No screenshot available')
    return applyDecorations(screenshot, settings, deps)
}

export type DownloadSharePngDeps = DecorationDeps & {
    getScreenshot?: GetScreenshot
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
    const composed = await captureDecorated(getScreenshot, deps)
    const filename =
        deps.filename ??
        buildExportFilename(composed.extension, await getViewState())
    download(composed.blob, filename)
    return composed
}

export type DownloadSharePdfDeps = DecorationDeps & {
    getScreenshot?: GetScreenshot
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
    const composed = await captureDecorated(getScreenshot, deps)
    const dataUrl = await convertBlobToDataUrl(composed.blob)
    const doc = await buildPdf(dataUrl, composed.width, composed.height)
    const filename =
        deps.filename ?? buildExportFilename('pdf', await getViewState())
    doc.save(filename)
    return doc
}
