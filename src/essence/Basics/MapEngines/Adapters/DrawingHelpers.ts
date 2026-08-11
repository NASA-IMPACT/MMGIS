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
 * The keys a mode finishes and cancels on.
 *
 * Rectangle and circle commit on their second click, so there is no state in
 * which Enter has a sensible shape to commit: it would finish a zero-area
 * rectangle from one corner, or a circle of the mode's minimum radius from its
 * center. `null` is how terra-draw is told a key is unbound, so Enter stays
 * with the click-per-vertex modes the panel hints advertise it for.
 */
export function drawModeKeyEvents(
    shape: DrawShape,
    cancelOnEscape: boolean
): { finish: string | null; cancel: string | null } {
    return {
        finish: shape === 'linestring' || shape === 'polygon' ? 'Enter' : null,
        cancel: cancelOnEscape ? 'Escape' : null,
    }
}

/**
 * Elements that own Enter and Escape themselves: text entry commits on Enter
 * and clears on Escape, and dialogs, menus and listboxes close on Escape. A
 * key pressed inside one of them belongs to it, not to the drawing session.
 */
const KEY_OWNING_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="dialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[role="combobox"]',
].join(',')

function ownsDrawKeys(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(KEY_OWNING_SELECTOR) !== null
}

export interface DrawKeyBridgeOptions {
    /** The element terra-draw's adapter attaches its key listeners to. */
    getEventElement: () => HTMLElement | null
    /** Whether a drawing session is still active. */
    isDrawing: () => boolean
    /** Honours `DrawingOptions.cancelOnEscape`. */
    cancelOnEscape: boolean
    /** Ends the session and emits `drawcancel`. */
    onCancel: () => void
}

export interface DrawKeyBridge {
    install(): void
    remove(): void
}

/**
 * terra-draw's Enter/Escape listeners live on the map canvas or container,
 * which only receives key events while focused — after any panel interaction
 * they go nowhere. While a session is active, this document-level bridge
 * handles Escape itself (terra-draw's own Escape path only deletes the
 * geometry and emits no event the adapter observes, so `drawcancel` must come
 * from here regardless) and forwards Enter to that element as the `keyup`
 * terra-draw listens for.
 *
 * Both keys are read on `keydown`, because that is where the components that
 * own them act: a field blurs itself on Enter and a popover closes on Escape,
 * so by `keyup` the event no longer originates anywhere the guard can see.
 */
export function createDrawKeyBridge(options: DrawKeyBridgeOptions): DrawKeyBridge {
    const onKeyDown = (evt: KeyboardEvent) => {
        if (!options.isDrawing()) return
        if (ownsDrawKeys(evt.target)) return

        if (evt.key === 'Escape') {
            if (options.cancelOnEscape) options.onCancel()
            return
        }
        if (evt.key !== 'Enter') return

        const el = options.getEventElement()
        // When the key already landed inside that element, terra-draw's own
        // listener gets the real keyup — forwarding would fire it twice.
        if (el && !el.contains(evt.target as Node)) {
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
        }
    }

    return {
        install: () => document.addEventListener('keydown', onKeyDown),
        remove: () => document.removeEventListener('keydown', onKeyDown),
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
