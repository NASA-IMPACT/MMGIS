import F_ from '../Formulae_/Formulae_'
import type { IMapEngine, MapScreenshotResult } from './IMapEngine'
import type { LatLng, LatLngLike } from './types/geometry'

type ScaleEngine = Pick<IMapEngine, 'containerPointToLatLng' | 'getContainer' | 'getViewState'>

/** A position on the page, in CSS pixels, as a DOM rectangle or event gives it. */
export type ClientPoint = { clientX: number; clientY: number }

// The scale is the ground length of a short horizontal segment on screen.
// Short keeps it local to the point; a long one at world zooms would measure a
// great-circle chord rather than the distance along the screen row.
const PROBE_PX = 10

// Both adapters answer with the object form; a tuple is in Leaflet order.
const toLatLng = (p: LatLngLike): LatLng =>
    Array.isArray(p) ? { lat: p[0], lng: p[1] } : (p as LatLng)

/** Tilt, in degrees, beyond which the map has no scale. A tilted map's scale
 *  shrinks toward the camera and grows toward the horizon (by about a quarter
 *  at the bottom edge at 45°), so no single bar describes the view. */
export const MAX_SCALE_PITCH_DEG = 10

/** How far in from the map's bottom-left corner the scale is measured when no
 *  point is given: about where an export draws its scale bar. */
export const DEFAULT_SCALE_INSET_PX = 16

/**
 * Ground metres per CSS pixel at `at`, or near the map's bottom-left corner
 * when `at` is omitted.
 *
 * The engine places two points a few pixels apart on the ground and the
 * distance between them is measured on the mission's planet, so the result
 * holds for any engine or projection — at that point. Mercator's scale changes
 * with latitude, so a bar measured elsewhere on the screen would be off at
 * wide zooms.
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
        const a = toLatLng(engine.containerPointToLatLng({ x, y }))
        const b = toLatLng(engine.containerPointToLatLng({ x: x + PROBE_PX, y }))
        const meters = F_.lngLatDistBetween(a.lng, a.lat, b.lng, b.lat)
        return Number.isFinite(meters) && meters > 0 ? meters / PROBE_PX : null
    } catch {
        return null
    }
}

/**
 * Captures the map and stamps the screenshot with the ground metres one
 * *image* pixel spans near its bottom-left corner, where an export draws its
 * scale bar.
 *
 * The scale is read before the capture starts, so a slow capture still
 * carries the scale of the view it began with. Image pixels outnumber CSS
 * pixels by whatever ratio the engine rendered at, which the image's width
 * against the map's gives directly.
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
