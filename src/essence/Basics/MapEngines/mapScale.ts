import F_ from '../Formulae_/Formulae_'
import type { IMapEngine, MapScreenshotResult } from './IMapEngine'
import type { LatLng } from './types/geometry'

type ScaleEngine = Pick<
    IMapEngine,
    'containerPointToLatLng' | 'getContainer' | 'getViewState'
>

/** A position on the page, in CSS pixels, as a DOM rectangle or event gives it. */
export type ClientPoint = { clientX: number; clientY: number }

/** A position in the map container, in CSS pixels from its top-left corner. */
export type ContainerPoint = { x: number; y: number }

// The scale is the ground length of a short horizontal segment on screen.
// Short keeps it local to the point; a long one at world zooms would measure a
// great-circle chord rather than the distance along the screen row.
const PROBE_PX = 10

// Web Mercator's world ends at this latitude. Points past the world's top or
// bottom edge unproject toward the pole rather than failing, so a latitude
// beyond it marks a point with no ground under it.
const MERCATOR_MAX_LAT = 85.0511287798

// Whether the map is in Web Mercator: the default projection, or a custom one
// built from a `+proj=merc` definition.
const isMercator = (): boolean => {
    const projString = (window as any).mmgisglobal?.customCRS?.projString
    return typeof projString !== 'string' || /\+proj=merc\b/.test(projString)
}

/** Tilt, in degrees, beyond which an export carries no scale. A tilted map's scale
 *  shrinks toward the camera and grows toward the horizon (by about a quarter
 *  at the bottom edge at 45°), so no single bar describes the view. */
export const MAX_SCALE_PITCH_DEG = 10

/** How far in from the image's bottom-left corner an export measures its
 *  scale when no point is given: about where it draws its scale bar. */
export const DEFAULT_SCALE_INSET_PX = 16

/** The most the scale may differ, as a ratio, between the top and bottom of
 *  the view before an export carries no scale. Web Mercator's scale grows with
 *  1/cos(latitude), so this allows a view from 0° to about 48°, or from 45° to
 *  about 62°, and rules out continent- and world-wide views. */
export const MAX_SCALE_SPREAD = 1.5

// Points arrive over the bus, so anything but a finite point is ignored.
const isContainerPoint = (at: ContainerPoint | undefined): at is ContainerPoint =>
    !!at && Number.isFinite(at.x) && Number.isFinite(at.y)

const isClientPoint = (at: ClientPoint | undefined): at is ClientPoint =>
    !!at && Number.isFinite(at.clientX) && Number.isFinite(at.clientY)

type ScaleReading = {
    metersPerPixel: number
    /** The container point, in CSS pixels, the reading describes. */
    x: number
    y: number
}

// Ground metres per CSS pixel at container point (x, y). Null where the
// engine cannot place the points.
function scaleAt(engine: ScaleEngine, x: number, y: number): number | null {
    // Both adapters answer in the object form.
    const a = engine.containerPointToLatLng({ x, y }) as LatLng
    const b = engine.containerPointToLatLng({ x: x + PROBE_PX, y }) as LatLng
    const meters = F_.lngLatDistBetween(a.lng, a.lat, b.lng, b.lat)
    return Number.isFinite(meters) && meters > 0 ? meters / PROBE_PX : null
}

// Rows, as fractions of the map's height, the scale is sampled on to judge
// how much it varies over the view. The middle row matters: a view centred
// on the equator has the same scale at its top and bottom.
const SPREAD_ROWS = [0, 0.25, 0.5, 0.75, 1]

function readScale(engine: ScaleEngine, at?: ClientPoint): ScaleReading | null {
    try {
        const rect = engine.getContainer().getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0)) return null
        if (Math.abs(engine.getViewState().pitch ?? 0) > MAX_SCALE_PITCH_DEG) return null
        const given = isClientPoint(at)
        const x = given ? at.clientX - rect.left : DEFAULT_SCALE_INSET_PX
        const y = given ? at.clientY - rect.top : rect.height - DEFAULT_SCALE_INSET_PX
        const metersPerPixel = scaleAt(engine, x, y)
        if (metersPerPixel == null) return null
        // Zoomed out far enough, the view spans latitudes whose scales differ
        // widely and no single bar describes it. The spread only grows as the
        // map zooms out: rows past a Mercator world's top or bottom edge
        // unproject toward the pole, where the scale falls toward zero. Rows
        // the engine cannot place (off a custom projection's extent) do not
        // count against it.
        const top = DEFAULT_SCALE_INSET_PX
        const span = rect.height - 2 * DEFAULT_SCALE_INSET_PX
        const scales = [
            metersPerPixel,
            ...SPREAD_ROWS.map((f) => scaleAt(engine, x, top + f * span)),
        ].filter((s): s is number => s != null)
        if (Math.max(...scales) / Math.min(...scales) > MAX_SCALE_SPREAD) return null
        return { metersPerPixel, x, y }
    } catch {
        return null
    }
}

/**
 * Ground metres per CSS pixel at container point `at`, or at the map's centre
 * when `at` is omitted. Unprojects two points PROBE_PX apart and measures the
 * great-circle distance between them on the mission's planet, so it works for
 * any engine. The scale is local to the point, so it holds at any zoom and on
 * a tilted map.
 *
 * Null when the map has no size, the point is outside the map or off a Web
 * Mercator world, the engine cannot place the points, or the planet radius is
 * not configured.
 */
export function metersPerPixelAt(engine: ScaleEngine, at?: ContainerPoint): number | null {
    try {
        const rect = engine.getContainer().getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0)) return null
        const { x, y } = isContainerPoint(at) ? at : { x: rect.width / 2, y: rect.height / 2 }
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
        const ground = engine.containerPointToLatLng({ x, y }) as LatLng
        if (isMercator() && !(Math.abs(ground.lat) <= MERCATOR_MAX_LAT)) return null
        return scaleAt(engine, x, y)
    } catch {
        return null
    }
}

/**
 * Captures the map and stamps the screenshot with the ground metres one
 * *image* pixel spans at `scaleAt`, or near the image's bottom-left corner
 * without it. With `scaleAt`, `scaleAnchor` gives that point in image pixels.
 * The scale is read before the capture starts, so it matches the captured
 * view; the image-to-CSS pixel ratio comes from the image's width against the
 * map's.
 */
export async function captureScreenshotWithScale(
    engine: ScaleEngine & Pick<IMapEngine, 'captureScreenshot'>,
    scaleAt?: ClientPoint
): Promise<MapScreenshotResult> {
    const reading = readScale(engine, scaleAt)
    const cssWidth = reading == null ? 0 : engine.getContainer().clientWidth
    const screenshot = await engine.captureScreenshot()
    const ratio =
        reading != null && cssWidth > 0 && screenshot.width > 0
            ? screenshot.width / cssWidth
            : null
    if (ratio == null) return { ...screenshot, metersPerPixel: null }
    const result: MapScreenshotResult = {
        ...screenshot,
        metersPerPixel: reading!.metersPerPixel / ratio,
    }
    if (isClientPoint(scaleAt)) {
        result.scaleAnchor = { x: reading!.x * ratio, y: reading!.y * ratio }
    }
    return result
}
