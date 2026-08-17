/**
 * Shared drawing helpers used by both engine adapters' terra-draw integrations.
 */

import { DrawShape } from '../types/events'

/** The subset of a terra-draw store snapshot the helpers read. */
export interface DrawSnapshotFeature {
    properties?: Record<string, unknown> | null
    geometry: GeoJSON.Geometry
}

type LatLng = { lat: number; lng: number }

const toLatLng = (c: GeoJSON.Position): LatLng => ({ lng: c[0], lat: c[1] })

/** Midpoint of a ring's bounding box — the center of terra-draw's circle polygon. */
function ringCenter(ring: GeoJSON.Position[]): LatLng {
    const lngs = ring.map((c) => c[0])
    const lats = ring.map((c) => c[1])
    return {
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    }
}

/**
 * The vertices the user has actually committed on `feature`, or null when the
 * feature is not the in-progress geometry for `shape` — terra-draw also writes
 * guidance features (closing, snapping and coordinate points, all Points) to
 * the store, and they are often the last thing changed.
 *
 * Committed is narrower than "in the geometry": polygon and linestring both
 * carry an extra coordinate that tracks the pointer, and polygon starts life
 * as a ring of four copies of the first click. Polygon mode publishes its own
 * `committedCoordinateCount`; the other modes are derived from the geometry.
 */
export function extractCommittedVertices(
    shape: DrawShape,
    feature: DrawSnapshotFeature
): LatLng[] | null {
    const geom = feature.geometry

    if (shape === 'point') {
        return geom.type === 'Point' ? [toLatLng(geom.coordinates)] : null
    }

    if (shape === 'linestring') {
        if (geom.type !== 'LineString') return null
        // The last coordinate follows the pointer until the next click.
        return geom.coordinates.slice(0, -1).map(toLatLng)
    }

    if (geom.type !== 'Polygon') return null
    const ring = geom.coordinates[0] ?? []
    if (ring.length === 0) return null

    // Rectangle and circle commit on their second click, so an in-progress
    // feature only ever means "the first corner / center is placed".
    if (shape === 'rectangle' || shape === 'circle') {
        return [shape === 'rectangle' ? toLatLng(ring[0]) : ringCenter(ring)]
    }

    // Closed ring: the last coordinate repeats the first.
    const distinct = ring.slice(0, -1)
    const committed = feature.properties?.committedCoordinateCount
    return (
        typeof committed === 'number'
            ? distinct.slice(0, committed)
            : distinct
    ).map(toLatLng)
}

/**
 * The committed vertices behind a terra-draw `change`, or null when the change
 * only touched guidance features. Guidance features (closing, snapping and
 * coordinate points) change alongside the shape and are usually last, so take
 * the last id that is the shape's own geometry.
 */
export function committedVerticesFromChange(
    shape: DrawShape,
    ids: any[],
    getSnapshot: (id: any) => DrawSnapshotFeature | undefined
): LatLng[] | null {
    for (let i = ids.length - 1; i >= 0; i--) {
        const snap = getSnapshot(ids[i])
        const vertices = snap && extractCommittedVertices(shape, snap)
        if (vertices) return vertices
    }
    return null
}

/**
 * The keys terra-draw itself binds for a mode.
 *
 * Rectangle and circle commit on their second click, so there is no state in
 * which Enter has a sensible shape to commit: it would finish a zero-area
 * rectangle from one corner, or a circle of the mode's minimum radius from its
 * center. `null` is how terra-draw is told a key is unbound, so Enter stays
 * with the click-per-vertex modes the panel hints advertise it for.
 *
 * Cancel is unbound for every mode: terra-draw's own Escape deletes the
 * in-progress geometry and reports it as a `delete` change, which no adapter
 * listener reads, so the session would end without a `drawcancel`. Escape
 * belongs to whoever started the drawing, which ends the session — and emits
 * that event — through `disableDrawing()`.
 */
export function drawModeKeyEvents(
    shape: DrawShape
): { finish: string | null; cancel: null } {
    return {
        finish: shape === 'linestring' || shape === 'polygon' ? 'Enter' : null,
        cancel: null,
    }
}

/**
 * terra-draw's linestring mode finishes on Enter without checking how many
 * coordinates were committed, which yields a one-coordinate LineString. Modes
 * reject a finish whose validation fails, so require a real segment.
 *
 * terra-draw deletes the coordinate that follows the pointer before it runs
 * finish validation, so the coordinates counted here are the committed ones.
 */
export function validateDrawnLineString(
    feature: { geometry: GeoJSON.Geometry },
    context: { updateType: string }
): { valid: boolean; reason?: string } {
    if (
        context.updateType === 'finish' &&
        feature.geometry.type === 'LineString' &&
        feature.geometry.coordinates.length < 2
    ) {
        return { valid: false, reason: 'A line needs at least two vertices' }
    }
    return { valid: true }
}

/**
 * hammer's tap interval, in milliseconds — the one number every click deck
 * delivers is timed against.
 *
 * deck builds its `click` and `dblclick` on hammer `Tap` recognizers and leaves
 * their `interval: 300` and `posThreshold: 10` defaults alone (mjolnir.js
 * `hammerjs/recognizers/tap`, `@deck.gl/core` `RECOGNIZERS`). Two taps are one
 * double-click when their pointerups fall inside that interval and within those
 * ten pixels; and because deck wires each of the two recognizers to require the
 * other's failure, whichever of them wins waits a further interval after the
 * pointerup before it emits.
 */
const TAP_INTERVAL_MS = 300

/**
 * How long the guard keeps absorbing after the last pointer of the gesture that
 * ended a drawing, in milliseconds.
 *
 * The latest click that gesture can produce is deck's, one
 * {@link TAP_INTERVAL_MS} after its final pointerup; doubling the interval
 * leaves that much margin again for a busy main thread running the recognizer's
 * timer late. The margin is cheap: the user's own next gesture opens with a
 * pointerdown, and that closes the window outright rather than waiting for it.
 */
const CLICK_SETTLE_MS = TAP_INTERVAL_MS * 2

/**
 * The `doubleClickZoom` handler a map exposes, in either engine's spelling —
 * Leaflet's `L.Handler` and MapLibre's `DoubleClickZoomHandler` agree on
 * `enable`/`disable` and differ only on how the state is read back.
 */
export interface DoubleClickZoomHandler {
    enable(): void
    disable(): void
    /** Leaflet. */
    enabled?(): boolean
    /** MapLibre. */
    isEnabled?(): boolean
}

/**
 * Tells an engine that the clicks still to arrive ended a drawing, so they are
 * not reported as map clicks.
 *
 * terra-draw commits a shape on `pointerup` and the engine hears about the same
 * gesture's clicks only afterwards: Leaflet on the native `click` that follows,
 * deck.gl a tap interval later, since its recognizers wait to see whether a
 * double-click is coming. Both land after the session has ended, so an engine's
 * "am I drawing?" check no longer covers them, and reporting them hands every
 * consumer a map click the user never made — one that arrives after
 * `drawcomplete` and so dismisses whatever a plugin opened in response to it.
 *
 * That gesture is not always a single click. Finishing on a double-click is
 * trained behaviour, and terra-draw commits on the first of the two taps: the
 * second is still part of the same gesture, and it reaches the engine either as
 * a second Leaflet `click` — Leaflet has no double-click disambiguation — or as
 * the `onClick` deck maps its `dblclick` recognizer onto. So the guard absorbs
 * by time rather than by count:
 *
 * - A pointerdown within {@link TAP_INTERVAL_MS} of the finish may still be
 *   that second tap, so the window stays open.
 * - A pointerdown any later cannot be, which makes it the user starting a
 *   gesture of their own, and the window closes there and then.
 * - Every pointerup inside the window re-opens it for {@link CLICK_SETTLE_MS},
 *   which is how long the engine may take to turn that pointer into a click.
 *
 * The window also closes on its own, so a session that ended without a click at
 * all — Enter, Escape, a mode switch — cannot leave the guard absorbing.
 */
export class DrawEndClickGuard {
    private _armedAt = 0
    private _openUntil = 0
    private _element: HTMLElement | null = null
    private _closeTimer: ReturnType<typeof setTimeout> | null = null
    private _zoom: DoubleClickZoomHandler | null = null
    private _zoomWasEnabled = false

    private readonly _onPointerDown = (): void => {
        if (this.pending && Date.now() - this._armedAt > TAP_INTERVAL_MS) {
            this._close()
        }
    }

    private readonly _onPointerUp = (): void => {
        if (this.pending) this._openFor(CLICK_SETTLE_MS)
    }

    /**
     * Cover the clicks that may still arrive from the gesture that just ended a
     * drawing session.
     *
     * @param element The element the engine's pointer events reach. Without one
     * the guard stays open: an engine with no map cannot be delivering clicks.
     * @param doubleClickZoom The map's double-click zoom handler, when it has
     * one. terra-draw re-enables it the moment the mode stops, which would let
     * a double-click finish zoom the map as well; the guard holds the re-enable
     * back until its window closes. Pass it after terra-draw has stopped, so
     * the state captured to restore is the one terra-draw left behind.
     */
    arm(
        element: HTMLElement | null,
        doubleClickZoom?: DoubleClickZoomHandler | null
    ): void {
        if (!element) return
        if (element !== this._element) {
            this.dispose()
            this._element = element
            element.addEventListener('pointerdown', this._onPointerDown, true)
            element.addEventListener('pointerup', this._onPointerUp, true)
        }
        this._armedAt = Date.now()
        this._openFor(CLICK_SETTLE_MS)
        this._suspendDoubleClickZoom(doubleClickZoom)
    }

    /** Whether a click reaching the engine now can only be the drawing's. */
    get pending(): boolean {
        return Date.now() < this._openUntil
    }

    /** Stop watching for the next gesture. Arming again resumes it. */
    dispose(): void {
        this._close()
        this._element?.removeEventListener('pointerdown', this._onPointerDown, true)
        this._element?.removeEventListener('pointerup', this._onPointerUp, true)
        this._element = null
    }

    private _openFor(ms: number): void {
        this._openUntil = Date.now() + ms
        if (this._closeTimer) clearTimeout(this._closeTimer)
        this._closeTimer = setTimeout(() => this._close(), ms)
    }

    private _close(): void {
        this._openUntil = 0
        if (this._closeTimer) {
            clearTimeout(this._closeTimer)
            this._closeTimer = null
        }
        const zoom = this._zoom
        this._zoom = null
        // The map is torn down under the guard on a mission swap.
        if (zoom && this._zoomWasEnabled) {
            try { zoom.enable() } catch { /* map already gone */ }
        }
    }

    private _suspendDoubleClickZoom(handler?: DoubleClickZoomHandler | null): void {
        if (!handler) return
        // Re-arming inside an open window must not read the state back off a
        // handler this guard is the one holding disabled.
        if (!this._zoom) {
            this._zoomWasEnabled = handler.enabled?.() ?? handler.isEnabled?.() ?? true
        }
        this._zoom = handler
        try { handler.disable() } catch { /* map already gone */ }
    }
}

/**
 * Reads a design token off :root, resolved to a concrete value.
 *
 * terra-draw's styling takes hex colors, not CSS — the values it is handed
 * reach the renderer as literal colors, which do not resolve var(). A theme
 * emitting a non-hex color would fail terra-draw's own styling validation, so
 * anything that isn't a hex falls back too.
 *
 * Read when the modes are built rather than at module load: the theme bundle
 * is fetched at runtime and may not have applied when this file is evaluated.
 */
type HexColor = `#${string}`

function themeColor(name: string, fallback: HexColor): HexColor {
    if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
    const value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim()
    return /^#[0-9a-f]{3,8}$/i.test(value) ? (value as HexColor) : fallback
}

/**
 * Stroke width of a drawing in progress, in pixels.
 *
 * Matches the width a plugin draws the committed shape at, so the outline does
 * not thicken or thin at the moment the drawing is confirmed. terra-draw's own
 * default is 4, which reads heavier than the shape it becomes.
 */
const DRAW_STROKE_WIDTH = 2

/**
 * The accent a drawing in progress is rendered in.
 *
 * Only colors and the stroke width are stated; opacities are left unset so
 * terra-draw applies its own. That matters for the fill: it and the outline
 * share a color, and it is the fill's lower opacity alone that lets the
 * outline read as an edge rather than disappearing into the area it encloses.
 *
 * The fallback is the horizon palette, for when no theme bundle is loaded.
 */
export function drawStyles(): {
    polygon: {
        fillColor: HexColor
        outlineColor: HexColor
        outlineWidth: number
        closingPointColor: HexColor
    }
    rectangle: { fillColor: HexColor; outlineColor: HexColor; outlineWidth: number }
    circle: { fillColor: HexColor; outlineColor: HexColor; outlineWidth: number }
    linestring: {
        lineStringColor: HexColor
        lineStringWidth: number
        closingPointColor: HexColor
    }
    point: { pointColor: HexColor }
} {
    const accent = themeColor('--theme-color-primary', '#1c67e3')
    const area = {
        fillColor: accent,
        outlineColor: accent,
        outlineWidth: DRAW_STROKE_WIDTH,
    }

    return {
        polygon: { ...area, closingPointColor: accent },
        rectangle: { ...area },
        circle: { ...area },
        linestring: {
            lineStringColor: accent,
            lineStringWidth: DRAW_STROKE_WIDTH,
            closingPointColor: accent,
        },
        point: { pointColor: accent },
    }
}
