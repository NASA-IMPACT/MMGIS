import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    committedVerticesFromChange,
    createDrawKeyBridge,
    drawModeKeyEvents,
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
            expect(drawModeKeyEvents(shape, true).finish).toBe('Enter')
        }
    })

    // Enter on a two-click shape would commit a zero-area rectangle or a
    // minimum-radius circle, so terra-draw must have no finish key to match.
    test('leaves Enter unbound for the two-click shapes', () => {
        for (const shape of ['rectangle', 'circle']) {
            expect(drawModeKeyEvents(shape, true).finish).toBeNull()
        }
    })

    test('binds Escape to cancel unless cancelOnEscape is off', () => {
        expect(drawModeKeyEvents('polygon', true).cancel).toBe('Escape')
        expect(drawModeKeyEvents('polygon', false).cancel).toBeNull()
    })
})

test.describe('createDrawKeyBridge', () => {
    let eventElement
    let bridge
    let onCancel
    let forwarded

    function install({ cancelOnEscape = true, isDrawing = () => true } = {}) {
        bridge = createDrawKeyBridge({
            getEventElement: () => eventElement,
            isDrawing,
            cancelOnEscape,
            onCancel,
        })
        bridge.install()
    }

    function press(key, target) {
        target.dispatchEvent(
            new window.KeyboardEvent('keydown', { key, bubbles: true })
        )
    }

    beforeEach(() => {
        forwarded = []
        onCancel = vi.fn()
        eventElement = document.createElement('canvas')
        eventElement.addEventListener('keyup', (e) => forwarded.push(e.key))
        document.body.appendChild(eventElement)
    })

    afterEach(() => {
        if (bridge) bridge.remove()
        document.body.innerHTML = ''
    })

    test('cancels on Escape pressed on the body', () => {
        install()
        press('Escape', document.body)
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('honours cancelOnEscape: false', () => {
        install({ cancelOnEscape: false })
        press('Escape', document.body)
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('forwards Enter pressed on the body to terra-draw exactly once', () => {
        install()
        press('Enter', document.body)
        expect(forwarded).toEqual(['Enter'])
    })

    test('leaves Enter alone when it already reached terra-draw', () => {
        install()
        press('Enter', eventElement)
        expect(forwarded).toEqual([])
    })

    test('ignores both keys typed in a text field', () => {
        install()
        const input = document.createElement('input')
        document.body.appendChild(input)
        press('Enter', input)
        press('Escape', input)
        expect(forwarded).toEqual([])
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('ignores both keys pressed inside an open dialog', () => {
        install()
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        const button = document.createElement('button')
        dialog.appendChild(button)
        document.body.appendChild(dialog)
        press('Enter', button)
        press('Escape', button)
        expect(forwarded).toEqual([])
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('does nothing once the session has ended', () => {
        install({ isDrawing: () => false })
        press('Enter', document.body)
        press('Escape', document.body)
        expect(forwarded).toEqual([])
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('stops listening after remove', () => {
        install()
        bridge.remove()
        press('Escape', document.body)
        expect(onCancel).not.toHaveBeenCalled()
    })
})
