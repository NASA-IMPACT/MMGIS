import { test, expect, vi } from 'vitest'
import {
    committedVerticesFromChange,
    drawModeKeyEvents,
    DrawEndClickGuard,
    DrawPointerWatch,
    extractCommittedVertices,
    validateDrawnLineString,
} from '../../src/essence/Basics/MapEngines/Adapters/DrawingHelpers.ts'

// Snapshots as terra-draw writes them mid-draw. Polygon publishes its own
// committedCoordinateCount; the other modes carry a trailing coordinate that
// follows the pointer. Rectangles and circles are stored as Polygons too, so
// this fixture serves them as well.
const polygon = (ring, committedCoordinateCount) => ({
    properties: { committedCoordinateCount },
    geometry: { type: 'Polygon', coordinates: [ring] },
})
const guidancePoint = (property) => ({
    properties: { mode: 'polygon', [property]: true },
    geometry: { type: 'Point', coordinates: [1, 2] },
})

test.describe('extractCommittedVertices', () => {
    test("counts terra-draw's first polygon click as one vertex, not three", () => {
        const c = [10, 20]
        const vertices = extractCommittedVertices(
            'polygon',
            polygon([c, c, c, c], 1)
        )
        expect(vertices).toEqual([{ lng: 10, lat: 20 }])
    })

    test('drops the polygon coordinate that is still following the pointer', () => {
        const vertices = extractCommittedVertices(
            'polygon',
            polygon([[0, 0], [1, 1], [2, 2], [9, 9], [0, 0]], 3)
        )
        expect(vertices).toEqual([
            { lng: 0, lat: 0 },
            { lng: 1, lat: 1 },
            { lng: 2, lat: 2 },
        ])
    })

    test('falls back to the closed ring once the polygon is finished', () => {
        const vertices = extractCommittedVertices(
            'polygon',
            polygon([[0, 0], [1, 1], [2, 2], [0, 0]], undefined)
        )
        expect(vertices).toHaveLength(3)
    })

    test('ignores guidance features so they cannot clobber the count', () => {
        for (const property of ['closingPoint', 'snappingPoint', 'coordinatePoint']) {
            expect(
                extractCommittedVertices('polygon', guidancePoint(property))
            ).toBeNull()
        }
    })

    test('drops the linestring coordinate that is still following the pointer', () => {
        const vertices = extractCommittedVertices('linestring', {
            properties: {},
            geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5]] },
        })
        expect(vertices).toEqual([{ lng: 0, lat: 0 }])
    })

    test('reports one vertex for a rectangle in progress: the placed corner', () => {
        const vertices = extractCommittedVertices(
            'rectangle',
            polygon([[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]])
        )
        expect(vertices).toEqual([{ lng: 0, lat: 0 }])
    })

    test('reports one vertex for a circle in progress: its center', () => {
        const vertices = extractCommittedVertices(
            'circle',
            polygon([[0, 5], [5, 10], [10, 5], [5, 0], [0, 5]])
        )
        expect(vertices).toEqual([{ lng: 5, lat: 5 }])
    })

    test('returns the point itself for point mode', () => {
        const vertices = extractCommittedVertices('point', {
            properties: {},
            geometry: { type: 'Point', coordinates: [3, 4] },
        })
        expect(vertices).toEqual([{ lng: 3, lat: 4 }])
    })
})

test.describe('validateDrawnLineString', () => {
    const lineString = (coordinates) => ({
        geometry: { type: 'LineString', coordinates },
    })

    test('rejects finishing a line with a single coordinate', () => {
        const result = validateDrawnLineString(lineString([[0, 0]]), {
            updateType: 'finish',
        })
        expect(result.valid).toBe(false)
    })

    test('accepts finishing a line with a real segment', () => {
        const result = validateDrawnLineString(lineString([[0, 0], [1, 1]]), {
            updateType: 'finish',
        })
        expect(result.valid).toBe(true)
    })

    // terra-draw deletes the coordinate that follows the pointer before it
    // validates a finish, so a one-coordinate line here is one real click.
    test('never blocks the updates made while drawing', () => {
        for (const updateType of ['commit', 'provisional']) {
            const result = validateDrawnLineString(lineString([[0, 0]]), {
                updateType,
            })
            expect(result.valid).toBe(true)
        }
    })
})

test.describe('committedVerticesFromChange', () => {
    test('reads past the guidance features a change ends with', () => {
        const snapshots = {
            shape: polygon([[0, 0], [1, 1], [2, 2], [0, 0]], 3),
            closing: guidancePoint('closingPoint'),
        }
        const vertices = committedVerticesFromChange(
            'polygon',
            ['shape', 'closing'],
            (id) => snapshots[id]
        )
        expect(vertices).toHaveLength(3)
    })

    test('returns null when nothing changed is the shape itself', () => {
        const vertices = committedVerticesFromChange(
            'polygon',
            ['snapping'],
            () => guidancePoint('snappingPoint')
        )
        expect(vertices).toBeNull()
    })

    test('tolerates ids the store no longer has a snapshot for', () => {
        const vertices = committedVerticesFromChange(
            'polygon',
            ['deleted'],
            () => undefined
        )
        expect(vertices).toBeNull()
    })
})

test.describe('drawModeKeyEvents', () => {
    test('binds Enter for the modes that finish on a key', () => {
        for (const shape of ['linestring', 'polygon']) {
            expect(drawModeKeyEvents(shape).finish).toBe('Enter')
        }
    })

    // Enter on a two-click shape would commit a zero-area rectangle or a
    // minimum-radius circle, so terra-draw must have no finish key to match.
    test('leaves Enter unbound for the two-click shapes', () => {
        for (const shape of ['rectangle', 'circle']) {
            expect(drawModeKeyEvents(shape).finish).toBeNull()
        }
    })

    // terra-draw's own cancel deletes the geometry and reports only a delete
    // change, which ends the session with no drawcancel. Escape is the drawing
    // initiator's, and reaches the engine as disableDrawing().
    test('never binds a cancel key', () => {
        for (const shape of ['point', 'linestring', 'polygon', 'rectangle', 'circle']) {
            expect(drawModeKeyEvents(shape).cancel).toBeNull()
        }
    })
})

/** A DOM event stamped as the browser would stamp one made at `timeStamp`. */
const stamped = (type, timeStamp) => {
    const event = new Event(type)
    Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    return event
}

/**
 * An element standing in for the one the engine's pointer events reach. In the
 * page, because an event only propagates through `window` from a node that is.
 */
const mapElement = () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

test.describe('DrawPointerWatch', () => {
    // terra-draw commits from inside the pointer event, so the engine has yet
    // to make a click of the gesture the session is ending on.
    test('reports the pointer being dispatched as the click still to come', () => {
        const element = mapElement()
        const watch = new DrawPointerWatch()
        watch.start(element)

        for (const type of ['pointerdown', 'pointerup']) {
            const event = stamped(type, 1000)
            let pending = null
            const read = () => { pending = watch.pendingClick }
            element.addEventListener(type, read)
            element.dispatchEvent(event)
            element.removeEventListener(type, read)
            expect(pending).toBe(event)
        }
    })

    // deck holds every click a tap interval to see whether a double-click is
    // coming, so a pointerup that recent still has one on the way.
    test('keeps a pointerup that recent as the click still to come', () => {
        const element = mapElement()
        const watch = new DrawPointerWatch()
        watch.start(element)

        const up = stamped('pointerup', 1000)
        element.dispatchEvent(up)

        expect(watch.pendingClick).toBe(up)
    })

    // Any older and the click has been delivered on either engine. Covering
    // one would only swallow the click the user makes next.
    test('lets go of a pointerup older than the tap interval', () => {
        vi.useFakeTimers()
        try {
            const element = mapElement()
            const watch = new DrawPointerWatch()
            watch.start(element)

            element.dispatchEvent(stamped('pointerup', 1000))
            vi.advanceTimersByTime(301)

            expect(watch.pendingClick).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    // A session ended from a plugin's own panel ends on a pointer the map
    // never saw, and the engine owes no click for it.
    test('ignores a pointer that was not on the map', () => {
        const element = mapElement()
        const elsewhere = mapElement()
        const watch = new DrawPointerWatch()
        watch.start(element)

        elsewhere.dispatchEvent(stamped('pointerup', 1000))

        expect(watch.pendingClick).toBeNull()
    })
})

test.describe('DrawEndClickGuard', () => {
    // A click is normally stamped with the pointerup it was made from, which
    // puts it inside the horizon. A browser that stamps it at dispatch instead
    // puts it outside — but the guard saw it go by the element, and identity
    // answers on its own.
    test('owns a click of its own gesture stamped past the horizon', () => {
        const element = mapElement()
        const guard = new DrawEndClickGuard()
        guard.arm(stamped('pointerup', 1000), element)

        const click = stamped('click', 9999)
        element.dispatchEvent(click)

        expect(guard.owns(click)).toBe(true)
    })

    // The second tap of a double-click finish can be pressed at the very edge
    // of the interval that still makes it one, and released after it. The
    // gesture stays the drawing's, and carries the horizon with it.
    test('owns the click of a tap pressed at the edge of the interval', () => {
        const element = mapElement()
        const guard = new DrawEndClickGuard()
        guard.arm(stamped('pointerup', 1000), element)

        element.dispatchEvent(stamped('pointerdown', 1300))
        element.dispatchEvent(stamped('pointerup', 1360))

        expect(guard.owns(stamped('click', 1360))).toBe(true)
    })

    // What an engine hands over is not always the DOM event itself: deck's
    // overlaid overlay forwards MapLibre's `MapMouseEvent`, which carries the
    // native click as its own `originalEvent`.
    test('owns a click handed over wrapped in a library event', () => {
        const element = mapElement()
        const guard = new DrawEndClickGuard()
        guard.arm(stamped('pointerup', 1000), element)

        expect(guard.owns({ originalEvent: stamped('click', 1100) })).toBe(true)
    })

    // An engine with no map element cannot be delivering clicks, so there is
    // nothing to cover and nothing to listen on.
    test('arming without an element covers nothing', () => {
        const guard = new DrawEndClickGuard()

        guard.arm(stamped('pointerup', 1000), null)

        expect(guard.owns(stamped('click', 1100))).toBe(false)
    })

    // Double-click zoom is taken at the start of the session, because
    // terra-draw disables it as the mode starts and leaves it that way.
    test('gives double-click zoom back when the session leaves no click behind', () => {
        let enabled = true
        const handler = {
            enabled: () => enabled,
            enable: () => { enabled = true },
            disable: () => { enabled = false },
        }
        const guard = new DrawEndClickGuard()

        guard.holdDoubleClickZoom(handler)
        expect(enabled).toBe(false)
        guard.arm(null, mapElement())

        expect(enabled).toBe(true)
    })

    // A map configured without double-click zoom must not be given it.
    test('gives back the state the map had before the drawing', () => {
        let enabled = false
        const handler = {
            enabled: () => enabled,
            enable: () => { enabled = true },
            disable: () => { enabled = false },
        }
        const guard = new DrawEndClickGuard()

        guard.holdDoubleClickZoom(handler)
        guard.arm(null, mapElement())

        expect(enabled).toBe(false)
    })
})
