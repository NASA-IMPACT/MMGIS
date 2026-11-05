import type { MapScreenshotResult } from '../adapters/mmgisAPI'
import { measureLegendBand, drawLegendBand } from './renderLegendBand'
import type { ExportLegendModel } from './getExportLegendModel'
import { resolveBandTheme, loadBandFonts, type BandTheme } from './bandTheme'
import { drawScaleBar, SCALE_BAR_MARGIN } from './renderScaleBar'

export type ComposeDeps = {
    createBitmap?: (blob: Blob) => Promise<ImageBitmap>
    createCanvas?: () => HTMLCanvasElement
    scale?: number
    theme?: BandTheme
}

/**
 * Decorates a captured map image: the scale bar the screen showed, painted at
 * the map's bottom-left corner, and the legend band appended below the map.
 * The screenshot blob is the plugin/core boundary — decode it, draw onto a
 * canvas, re-encode in the same mime type. With neither a bar nor a legend
 * row to draw, the screenshot is returned untouched.
 */
export async function composeExportImage(
    screenshot: MapScreenshotResult,
    model: ExportLegendModel | null,
    deps: ComposeDeps = {},
): Promise<MapScreenshotResult> {
    const hasLegend = !!model && model.rows.length > 0
    const scaleBar = screenshot.scaleBar ?? null
    if (!hasLegend && !scaleBar) return screenshot
    const {
        createBitmap = (blob: Blob) => createImageBitmap(blob),
        createCanvas = () => document.createElement('canvas'),
        scale = Math.max(
            1,
            (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        ),
        theme = resolveBandTheme(),
    } = deps

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
        if (scaleBar) {
            const margin = SCALE_BAR_MARGIN * scale
            drawScaleBar(ctx, scaleBar, {
                left: margin,
                bottom: screenshot.height - margin,
                scale,
                theme,
            })
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
