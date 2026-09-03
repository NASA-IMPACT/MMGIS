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
 * ten pixels. Only `click` is wired to require the other's failure, and that is
 * what makes it the late one: with a failure to wait on, it holds its tap for a
 * further interval after the pointerup before emitting, where `dblclick`, which
 * waits on nothing, emits on the second pointerup itself.
 */
const TAP_INTERVAL_MS = 300

/**
 * How long the guard holds double-click zoom back after the gesture that ended
 * a drawing, in milliseconds — wall clock, and nothing to do with which clicks
 * are absorbed. A double-click finish must not zoom the map, and the browser
 * decides what is a double-click on its own clock; the hold outlasts the tap
 * interval with margin to spare, and ends early on the user's next gesture.
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
 * Where a drawing session's pointer is, for the sake of the clicks the engine
 * has yet to deliver from it.
 *
 * terra-draw drives its modes from `pointerdown`, `pointerup` and `keyup`
 * listeners on the map element and emits `finish` synchronously from inside
 * them, so a session that the user clicked or double-clicked to an end ends
 * inside a pointer event, and one they pressed Enter for does not. Two things
 * make that dependable. The capture phase runs from the root down, so a
 * listener on `window` sees a pointer before terra-draw's own listeners on the
 * map element do, whatever order those went on in. And an event's `eventPhase`
 * is `NONE` exactly while it is not being dispatched, so the end of a gesture
 * needs no bookkeeping of its own.
 *
 * Only pointers on the map element count, which is what the window listener
 * filters for. A session ended from a plugin's own panel — a Finish button, a
 * tab, a shape picker — leaves no click on the map behind, and the pointer
 * that pressed the button is not one the engine owes a click for.
 *
 * The gesture being over is not the end of the story, though, which is why the
 * last pointerup is kept as well as watched — see {@link pendingClick}.
 */
export class DrawPointerWatch {
    private _event: Event | null = null
    /** The last pointerup of the session, and when the wall clock saw it. */
    private _lastPointerUp: { event: Event; at: number } | null = null
    private _element: HTMLElement | null = null

    private readonly _onPointer = (event: Event): void => {
        const target = event.target
        if (
            !this._element ||
            !(target instanceof Node) ||
            !this._element.contains(target)
        )
            return
        this._event = event
        if (event.type === 'pointerup') {
            this._lastPointerUp = { event, at: Date.now() }
        }
    }

    /**
     * Watch for as long as a drawing session is live. Starting twice is safe.
     *
     * @param element The element the engine's pointer events reach. Pointers
     * elsewhere on the page are not the drawing's. Registration stays on
     * `window`, in the capture phase, so the watch still runs before
     * terra-draw's own listeners.
     */
    start(element: HTMLElement | null): void {
        this._element = element
        if (typeof window === 'undefined') return
        window.addEventListener('pointerdown', this._onPointer, true)
        window.addEventListener('pointerup', this._onPointer, true)
    }

    /** Stop watching, and let go of the last gesture. */
    stop(): void {
        this._event = null
        this._lastPointerUp = null
        this._element = null
        if (typeof window === 'undefined') return
        window.removeEventListener('pointerdown', this._onPointer, true)
        window.removeEventListener('pointerup', this._onPointer, true)
    }

    /** Whether a pointer of a gesture on the map is being dispatched now. */
    private get _inGesture(): boolean {
        return this._event !== null && this._event.eventPhase !== Event.NONE
    }

    /**
     * The pointer a click the engine still owes this session would be made
     * from, or null when it owes none.
     *
     * A pointer being dispatched right now is one: terra-draw commits from
     * inside it, and the engine turns the same gesture into a click only
     * afterwards. So is a pointerup dispatched {@link TAP_INTERVAL_MS} ago or
     * less, even though the session is ending on something else. deck holds
     * every click for that interval to see whether a double-click is coming,
     * so the click that placed the final vertex is still in its hands when
     * Enter — or a plugin that deferred past the pointerup — ends the session
     * under it, and lands once the drawing is over.
     *
     * A pointerup any older has had its click delivered already, on either
     * engine. A session ended with the pointer that idle — Enter pressed while
     * reading the shape back, a plugin's own button — leaves nothing on the
     * way, and covering it would only swallow the next click the user makes.
     *
     * "Ago" here is the wall clock, because deck's hold is a wall-clock timer.
     * It is the one place the clock is consulted about a pointer: the event
     * object is what goes to the guard, and its `timeStamp` is on a different
     * clock again (`performance.now()` in a browser, `Date.now()` in jsdom).
     */
    get pendingClick(): Event | null {
        if (this._inGesture) return this._event
        const last = this._lastPointerUp
        return last && Date.now() - last.at <= TAP_INTERVAL_MS
            ? last.event
            : null
    }
}

/**
 * Tells an engine which of the clicks it delivers belong to the drawing that
 * just ended, so they are not reported as map clicks.
 *
 * terra-draw commits a shape on `pointerup` and the engine hears about the same
 * gesture's clicks only afterwards: Leaflet on the native `click` that follows,
 * deck.gl a tap interval later, since its `click` waits to see whether a
 * double-click is coming. Both land after the session has ended, so an engine's
 * "am I drawing?" check no longer covers them, and reporting them hands every
 * consumer a map click the user never made — one that arrives after
 * `drawcomplete` and so dismisses whatever a plugin opened in response to it.
 *
 * How late they land is not something the guard can know. deck's click is a
 * timer that a busy main thread runs late, and Leaflet's native click is not
 * dispatched until the pointerup's handlers return — and `drawcomplete` runs
 * inside those, so whatever a plugin does in response holds the click up. A
 * guard that watched the clock at delivery would open a window, see the
 * finish take longer than the window, and report the click as the user's.
 *
 * So the guard judges a click by where it came from, not when it arrived. Both
 * engines hand over the DOM event a click was made from — deck the `srcEvent`
 * of its input event, Leaflet the click's `originalEvent` — and the guard
 * keeps two things to hold that against:
 *
 * - The drawing's own events, by identity. The pointer the session ended on,
 *   and the pointerups and clicks its gesture goes on to produce. deck's
 *   `srcEvent` is the very pointerup object terra-draw committed inside.
 * - A horizon in event time. A click is stamped with the pointerup it was
 *   made from, not with its dispatch, so a click stamped before the horizon
 *   was released before the drawing's gesture was over, however long the
 *   engine then sat on it.
 *
 * Either is enough on its own; a click is the drawing's if either says so.
 * Event stamps are compared only with each other, never with `Date.now()`:
 * a browser stamps from `performance.now()`, jsdom from `Date.now()`.
 *
 * That gesture is not always a single click. Finishing on a double-click is
 * trained behaviour, and which tap commits depends on the mode: the
 * click-per-vertex modes close on the last tap of the gesture, `point` on the
 * first. Either way a tap the session did not end on still reaches the engine
 * as a click — a second Leaflet `click`, since Leaflet has no double-click
 * disambiguation, or the `onClick` deck maps its `dblclick` recognizer onto.
 * So the gesture is followed on the map element, in event time:
 *
 * - The horizon opens one {@link TAP_INTERVAL_MS} past the pointer the session
 *   ended on. A pointerdown stamped inside that interval may be the second
 *   tap, so the gesture stays the drawing's: its pointerup and click are
 *   recorded, and the pointerup moves the horizon an interval past itself.
 * - A pointerdown stamped any later cannot be, which makes it the user
 *   starting a gesture of their own. Nothing of it is recorded, and the
 *   horizon is cut back to it: a click of theirs is stamped after their
 *   pointerdown, a click still owed from the drawing before it.
 *
 * The finish is not always what the horizon is timed from. Enter, or a plugin
 * that deferred past the pointerup, can end a session while deck is still
 * holding the click that placed the final vertex, and that click lands with the
 * drawing over exactly as a finishing one would, made from that pointerup.
 *
 * A session that ends with no pointer that recent has no click of its own on
 * the way, so it opens no horizon at all. A horizon that nothing ever reaches
 * — the pointerup was the end of a drag, and deck made no click of it — costs
 * nothing either: the user's next click is stamped past it.
 *
 * Double-click zoom is the one thing held on the wall clock. terra-draw
 * disables it as a mode starts and leaves it disabled when the mode stops, so
 * handing it back belongs to whoever took the session down — the guard, which
 * is handed it at the start of the session ({@link holdDoubleClickZoom}) and
 * gives it back {@link CLICK_SETTLE_MS} after the end of one, or on the user's
 * next gesture, or straight away when the session leaves no click behind. A
 * double-click that finishes a shape must not zoom the map as well.
 */
export class DrawEndClickGuard {
    /** The pointer the session ended on, in event time. */
    private _armedAt = 0
    /** Clicks stamped before this are the drawing's. Event time; 0 is none. */
    private _ownedUntil = 0
    /** Whether the gesture the element is seeing is still the drawing's. */
    private _gestureOwned = false
    /** The drawing's own DOM events, for a click to be matched against. */
    private _owned = new WeakSet<object>()
    private _element: HTMLElement | null = null
    private _holdTimer: ReturnType<typeof setTimeout> | null = null
    private _zoom: DoubleClickZoomHandler | null = null
    private _zoomWasEnabled = false

    private readonly _onPointerDown = (event: Event): void => {
        if (this._ownedUntil === 0) return
        this._gestureOwned = event.timeStamp - this._armedAt <= TAP_INTERVAL_MS
        if (!this._gestureOwned) {
            this._ownedUntil = Math.min(this._ownedUntil, event.timeStamp)
            this._release()
        }
    }

    private readonly _onPointerUp = (event: Event): void => {
        if (!this._gestureOwned) return
        this._owned.add(event)
        this._ownedUntil = Math.max(this._ownedUntil, event.timeStamp + TAP_INTERVAL_MS)
        this._holdFor(CLICK_SETTLE_MS)
    }

    private readonly _onClick = (event: Event): void => {
        if (this._gestureOwned) this._owned.add(event)
    }

    /**
     * Take the map's double-click zoom for a drawing session that is starting,
     * and give it back once the session's clicks are through ({@link arm}).
     *
     * Call before the mode starts: terra-draw disables the handler as a mode
     * starts and leaves it disabled when the mode stops, so this is the last
     * moment the map's own setting can be read. A session starting while the
     * guard is still holding from the previous one keeps that earlier reading
     * — the handler now reads as disabled because the guard is the one holding
     * it down — and supersedes the restore that was pending.
     *
     * @param handler The map's handler, when it has one.
     */
    holdDoubleClickZoom(handler?: DoubleClickZoomHandler | null): void {
        if (!handler) return
        if (this._holdTimer) {
            clearTimeout(this._holdTimer)
            this._holdTimer = null
        }
        // The last session's horizon is moot — no click is reported while a
        // drawing is live — and leaving it standing would let the user's next
        // gesture on the element release the hold mid-session.
        this._ownedUntil = 0
        this._gestureOwned = false
        if (!this._zoom) {
            this._zoomWasEnabled =
                handler.enabled?.() ?? handler.isEnabled?.() ?? true
        }
        this._zoom = handler
        try { handler.disable() } catch { /* map already gone */ }
    }

    /**
     * Cover the clicks the engine may still deliver from the gesture a drawing
     * session leaves behind, and start the clock on giving double-click zoom
     * back.
     *
     * @param pointer The pointer event the clicks belong to, as
     * {@link DrawPointerWatch.pendingClick} found it, or null when the session
     * leaves no click behind — then whatever the user does next is theirs,
     * double-click zoom goes back at once, and the previous cover, if any,
     * stands until its own hold runs out.
     * @param element The element the engine's pointer events reach. Without one
     * the guard stays out of the way: an engine with no map cannot be
     * delivering clicks.
     */
    arm(pointer: Event | null, element: HTMLElement | null): void {
        if (!pointer || !element) {
            this._release()
            return
        }
        if (element !== this._element) {
            this._unwatchElement()
            this._element = element
            element.addEventListener('pointerdown', this._onPointerDown, true)
            element.addEventListener('pointerup', this._onPointerUp, true)
            element.addEventListener('click', this._onClick, true)
        }
        this._owned.add(pointer)
        this._armedAt = pointer.timeStamp
        this._ownedUntil = pointer.timeStamp + TAP_INTERVAL_MS
        this._gestureOwned = true
        this._holdFor(CLICK_SETTLE_MS)
    }

    /**
     * Is the click made from `source` the drawing's?
     *
     * `source` is what the engine hands over with the click: deck's input
     * event's `srcEvent`, Leaflet's `originalEvent`. Either is the native DOM
     * event, except that deck's overlaid (non-interleaved) overlay forwards
     * MapLibre's `MapMouseEvent`, which wraps the native click as its own
     * `originalEvent` — so that is unwrapped first. A click with no source
     * event was made from no gesture, so it is never the drawing's.
     */
    owns(source: unknown): boolean {
        if (!source || typeof source !== 'object') return false
        const native = (source as { originalEvent?: unknown }).originalEvent ?? source
        if (!native || typeof native !== 'object') return false
        if (this._owned.has(native)) return true
        const stamp = (native as { timeStamp?: unknown }).timeStamp
        return (
            typeof stamp === 'number' &&
            this._ownedUntil !== 0 &&
            stamp < this._ownedUntil
        )
    }

    /** Stop watching for the next gesture and give double-click zoom back. */
    dispose(): void {
        this._release()
        this._ownedUntil = 0
        this._gestureOwned = false
        this._unwatchElement()
    }

    private _unwatchElement(): void {
        this._element?.removeEventListener('pointerdown', this._onPointerDown, true)
        this._element?.removeEventListener('pointerup', this._onPointerUp, true)
        this._element?.removeEventListener('click', this._onClick, true)
        this._element = null
    }

    private _holdFor(ms: number): void {
        if (this._holdTimer) clearTimeout(this._holdTimer)
        this._holdTimer = setTimeout(() => this._release(), ms)
    }

    /** Give double-click zoom back. The horizon stands: it is event time. */
    private _release(): void {
        if (this._holdTimer) {
            clearTimeout(this._holdTimer)
            this._holdTimer = null
        }
        const zoom = this._zoom
        this._zoom = null
        // The map is torn down under the guard on a mission swap.
        if (zoom && this._zoomWasEnabled) {
            try { zoom.enable() } catch { /* map already gone */ }
        }
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
