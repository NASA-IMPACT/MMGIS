import type { MapScreenshotResult } from '../adapters/mmgisAPI'
import { measureLegendBand, drawLegendBand } from './renderLegendBand'
import type { ExportLegendModel } from './getExportLegendModel'
import { resolveBandTheme, loadBandFonts, type BandTheme } from './bandTheme'
import {
    buildScaleBarModel,
    SCALE_BAR_MAX_WIDTH_PX,
    type ScaleUnits,
} from '../scale/scaleBarModel'
import {
    drawScaleBar,
    measureScaleBar,
    SCALE_BAR_MARGIN,
} from '../scale/renderScaleBar'

export type ExportScaleBar = {
    metersPerPixel: number
    units: ScaleUnits
    /** Image pixel for the bar's bottom-left corner, matching where the
     *  on-screen bar sits; the map's bottom-left corner when absent. */
    anchor?: { x: number; y: number } | null
}

export type ComposeDeps = {
    createBitmap?: (blob: Blob) => Promise<ImageBitmap>
    createCanvas?: () => HTMLCanvasElement
    scale?: number
    theme?: BandTheme
    scaleBar?: ExportScaleBar | null
}

// Low wins when the range is empty, keeping the bar's top-left on the image.
const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(v, hi))

// Keeps the bar from dominating a narrow capture.
const SCALE_BAR_MAX_IMAGE_SHARE = 1 / 3

/**
 * Decorates a captured map image: a scale bar over the map, at its anchor or
 * the bottom-left corner, and the legend band appended below the map. The
 * screenshot blob is the plugin/core boundary — decode it, draw onto a canvas,
 * re-encode in the same mime type. With neither a legend row nor a scale bar to draw, the
 * screenshot is returned untouched.
 */
export async function composeExportImage(
    screenshot: MapScreenshotResult,
    model: ExportLegendModel | null,
    deps: ComposeDeps = {},
): Promise<MapScreenshotResult> {
    const hasLegend = !!model && model.rows.length > 0
    const {
        createBitmap = (blob: Blob) => createImageBitmap(blob),
        createCanvas = () => document.createElement('canvas'),
        scale = Math.max(
            1,
            (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        ),
        theme = resolveBandTheme(),
        scaleBar = null,
    } = deps
    const barModel = scaleBar
        ? buildScaleBarModel(
              scaleBar.metersPerPixel,
              scaleBar.units,
              Math.min(
                  SCALE_BAR_MAX_WIDTH_PX * scale,
                  screenshot.width * SCALE_BAR_MAX_IMAGE_SHARE,
              ),
          )
        : null
    if (!hasLegend && !barModel) return screenshot

    await loadBandFonts(theme)
    const bitmap = await createBitmap(screenshot.blob)
    try {
        const canvas = createCanvas()
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            throw new Error('Export compositing needs a 2D canvas context')
        }
        // Measure on this same context before resizing the canvas: setting
        // canvas.width/height resets all context state (font, fillStyle,
        // ...), and drawLegendBand sets its own fonts before it draws
        // anyway, so nothing here depends on that state surviving the
        // resize. That makes a second, throwaway canvas just for measuring
        // unnecessary.
        const bandHeight = hasLegend
            ? measureLegendBand(ctx, model!, screenshot.width, scale, theme)
            : 0
        canvas.width = screenshot.width
        canvas.height = screenshot.height + bandHeight
        ctx.drawImage(bitmap, 0, 0)
        if (barModel) {
            const margin = SCALE_BAR_MARGIN * scale
            const box = measureScaleBar(ctx, barModel, scale, theme)
            const anchor = scaleBar!.anchor
            // An anchor near an edge is pulled in so the whole bar shows.
            const left = anchor
                ? clamp(anchor.x, margin, screenshot.width - box.width - margin)
                : margin
            const bottom = anchor
                ? clamp(anchor.y, box.height + margin, screenshot.height - margin)
                : screenshot.height - margin
            drawScaleBar(ctx, barModel, { left, bottom, scale, theme })
        }
        if (hasLegend) {
            drawLegendBand(
                ctx,
                model!,
                screenshot.width,
                screenshot.height,
                bandHeight,
                scale,
                theme,
            )
        }
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, screenshot.mimeType),
        )
        if (!blob) throw new Error('Export compositing produced no image')
        return { ...screenshot, blob, height: canvas.height }
    } finally {
        bitmap.close?.()
    }
}
