import F_ from '../Formulae_/Formulae_'
import type { IMapEngine, MapScreenshotResult } from './IMapEngine'
import type { LatLng } from './types/geometry'

type ScaleEngine = Pick<IMapEngine, 'containerPointToLatLng' | 'getContainer' | 'getViewState'>

/** A position on the page, in CSS pixels, as a DOM rectangle or event gives it. */
export type ClientPoint = { clientX: number; clientY: number }

// The scale is the ground length of a short horizontal segment on screen.
// Short keeps it local to the point; a long one at world zooms would measure a
// great-circle chord rather than the distance along the screen row.
const PROBE_PX = 10

/** Tilt, in degrees, beyond which the map has no scale. A tilted map's scale
 *  shrinks toward the camera and grows toward the horizon (by about a quarter
 *  at the bottom edge at 45°), so no single bar describes the view. */
export const MAX_SCALE_PITCH_DEG = 10

/** How far in from the map's bottom-left corner the scale is measured when no
 *  point is given: about where an export draws its scale bar. */
export const DEFAULT_SCALE_INSET_PX = 16

/**
 * Ground metres per CSS pixel at `at`, or near the map's bottom-left corner
 * when `at` is omitted. Unprojects two points PROBE_PX apart and measures the
 * great-circle distance between them on the mission's planet, so it works for
 * any engine.
 *
 * Null when the map has no size, is tilted beyond MAX_SCALE_PITCH_DEG, the
 * engine cannot place the points, or the planet radius is not configured.
 */
export function metersPerPixelAt(engine: ScaleEngine, at?: ClientPoint): number | null {
    try {
        const rect = engine.getContainer().getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0)) return null
        if (Math.abs(engine.getViewState().pitch ?? 0) > MAX_SCALE_PITCH_DEG) return null
        // `at` arrives over the bus, so anything but a finite point is ignored.
        const given = !!at && Number.isFinite(at.clientX) && Number.isFinite(at.clientY)
        const x = given ? at!.clientX - rect.left : DEFAULT_SCALE_INSET_PX
        const y = given ? at!.clientY - rect.top : rect.height - DEFAULT_SCALE_INSET_PX
        // Both adapters answer in the object form.
        const a = engine.containerPointToLatLng({ x, y }) as LatLng
        const b = engine.containerPointToLatLng({ x: x + PROBE_PX, y }) as LatLng
        const meters = F_.lngLatDistBetween(a.lng, a.lat, b.lng, b.lat)
        return Number.isFinite(meters) && meters > 0 ? meters / PROBE_PX : null
    } catch {
        return null
    }
}

/**
 * Captures the map and stamps the screenshot with the ground metres one
 * *image* pixel spans near its bottom-left corner. The scale is read before
 * the capture starts, so it matches the captured view; the image-to-CSS pixel
 * ratio comes from the image's width against the map's.
 */
export async function captureScreenshotWithScale(
    engine: ScaleEngine & Pick<IMapEngine, 'captureScreenshot'>
): Promise<MapScreenshotResult> {
    const cssMetersPerPixel = metersPerPixelAt(engine)
    const cssWidth = cssMetersPerPixel == null ? 0 : engine.getContainer().clientWidth
    const screenshot = await engine.captureScreenshot()
    const metersPerPixel =
        cssMetersPerPixel != null && cssWidth > 0 && screenshot.width > 0
            ? (cssMetersPerPixel * cssWidth) / screenshot.width
            : null
    return { ...screenshot, metersPerPixel }
}
