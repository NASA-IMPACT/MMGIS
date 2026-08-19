import type { MapScreenshotResult } from './mmgisAPI'
import { measureLegendBand, drawLegendBand } from '../legend/renderLegendBand'
import type { ExportLegendModel } from '../legend/getExportLegendModel'

export type ComposeDeps = {
    createBitmap?: (blob: Blob) => Promise<ImageBitmap>
    createCanvas?: () => HTMLCanvasElement
    scale?: number
}

/**
 * Appends the legend band below a captured map image. The screenshot blob is
 * the plugin/core boundary — decode it, extend the canvas downward, re-encode
 * in the same mime type. An empty model returns the screenshot untouched.
 */
export async function composeExportImage(
    screenshot: MapScreenshotResult,
    model: ExportLegendModel | null,
    deps: ComposeDeps = {},
): Promise<MapScreenshotResult> {
    if (!model || model.rows.length === 0) return screenshot
    const {
        createBitmap = (blob: Blob) => createImageBitmap(blob),
        createCanvas = () => document.createElement('canvas'),
        scale = Math.max(
            1,
            (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        ),
    } = deps

    const bitmap = await createBitmap(screenshot.blob)
    try {
        const canvas = createCanvas()
        const measureCtx = createCanvas().getContext('2d')
        const ctx = canvas.getContext('2d')
        if (!ctx || !measureCtx) {
            throw new Error('Legend compositing needs a 2D canvas context')
        }
        const bandHeight = measureLegendBand(
            measureCtx,
            model,
            screenshot.width,
            scale,
        )
        canvas.width = screenshot.width
        canvas.height = screenshot.height + bandHeight
        ctx.drawImage(bitmap, 0, 0)
        drawLegendBand(
            ctx,
            model,
            screenshot.width,
            screenshot.height,
            bandHeight,
            scale,
        )
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, screenshot.mimeType),
        )
        if (!blob) throw new Error('Legend compositing produced no image')
        return { ...screenshot, blob, height: canvas.height }
    } finally {
        bitmap.close?.()
    }
}
