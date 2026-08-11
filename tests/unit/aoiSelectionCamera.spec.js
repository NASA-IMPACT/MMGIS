import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    selectionFitBounds,
    selectionTooltipAnchor,
} from '../../src/essence/Tools/AOI/aoiHelpers.ts'
import AOITool from '../../src/essence/Tools/AOI/AOITool.js'

// Deliberately asymmetric so a predicate that swapped lat and lng, or dropped
// one of the two axes, would fail rather than coincide with the right answer.
const view = {
    southWest: { lat: 30, lng: -100 },
    northEast: { lat: 40, lng: -90 },
}

// Alaska's bundled boundary: parts either side of ±180 make the naive sweep
// ~359° wide, and the vertex-mean centroid lands at -139°, well outside a
// lower-48 view.
const ALASKA_BBOX = [-179.17, 51.22, 179.77, 71.35]

const flush = () => new Promise((resolve) => setTimeout(resolve))

const squareFeature = (w, s, e, n) => ({
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'Polygon',
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    },
})

test.describe('selectionFitBounds', () => {
    test('returns null when the selection is fully inside the view', () => {
        expect(selectionFitBounds([-98, 32, -92, 38], view)).toBeNull()
    })

    test('returns null for a selection exactly filling the view', () => {
        expect(selectionFitBounds([-100, 30, -90, 40], view)).toBeNull()
    })

    test('fits a selection that overflows the view east-west only', () => {
        const fit = selectionFitBounds([-98, 32, -80, 38], view)
        expect(fit?.bounds).toEqual([
            { lat: 32, lng: -98 },
            { lat: 38, lng: -80 },
        ])
        // Modest margin, and a maxZoom high enough never to bind on an
        // ordinary selection.
        expect(fit?.options.padding).toBeLessThanOrEqual(60)
        expect(fit?.options.maxZoom).toBeGreaterThanOrEqual(16)
    })

    test('fits a selection that overflows the view north-south only', () => {
        const fit = selectionFitBounds([-98, 20, -92, 45], view)
        expect(fit?.bounds).toEqual([
            { lat: 20, lng: -98 },
            { lat: 45, lng: -92 },
        ])
    })

    test('fits a fully off-screen selection', () => {
        expect(selectionFitBounds([10, 50, 15, 55], view)).not.toBeNull()
    })

    test('fits when the current view is unknown', () => {
        expect(selectionFitBounds([-98, 32, -92, 38], null)).not.toBeNull()
    })

    test('returns null for zero-area extents', () => {
        expect(selectionFitBounds([-95, 32, -95, 38], view)).toBeNull()
        expect(selectionFitBounds([-98, 35, -92, 35], view)).toBeNull()
    })

    test('returns null for antimeridian-spanning naive sweeps (Alaska)', () => {
        expect(selectionFitBounds(ALASKA_BBOX, view)).toBeNull()
    })

    test('treats a view wrapped across the antimeridian as contiguous', () => {
        const wrapped = {
            southWest: { lat: 30, lng: 170 },
            northEast: { lat: 40, lng: -170 },
        }
        // Both sides of the antimeridian are inside this 170..-170 window.
        expect(selectionFitBounds([172, 32, 178, 38], wrapped)).toBeNull()
        expect(selectionFitBounds([-178, 32, -172, 38], wrapped)).toBeNull()
        expect(selectionFitBounds([160, 32, 165, 38], wrapped)).not.toBeNull()
    })

    test('normalizes a view whose lat corners arrive swapped (rotated camera)', () => {
        const swapped = {
            southWest: { lat: 40, lng: -100 },
            northEast: { lat: 30, lng: -90 },
        }
        expect(selectionFitBounds([-98, 32, -92, 38], swapped)).toBeNull()
        expect(selectionFitBounds([-98, 20, -92, 45], swapped)).not.toBeNull()
    })

    test('treats an unwrapped panned view as contiguous', () => {
        const unwrapped = {
            southWest: { lat: 30, lng: 190 },
            northEast: { lat: 40, lng: 210 },
        }
        // -165..-155 is 195..205 unwrapped, inside the view.
        expect(selectionFitBounds([-165, 32, -155, 38], unwrapped)).toBeNull()
        expect(selectionFitBounds([-175, 32, -155, 38], unwrapped)).not.toBeNull()
    })
})

test.describe('selectionTooltipAnchor', () => {
    const centroid = { lat: 35, lng: -95 }

    test('keeps a centroid that is inside the view', () => {
        expect(selectionTooltipAnchor(centroid, view)).toEqual(centroid)
    })

    test('keeps the centroid when no view is supplied (camera was fitted)', () => {
        expect(selectionTooltipAnchor(centroid)).toEqual(centroid)
    })

    test('falls back to the view centre for an off-screen centroid (Alaska)', () => {
        expect(selectionTooltipAnchor({ lat: 58.4, lng: -139.3 }, view)).toEqual({
            lat: 35,
            lng: -95,
        })
    })

    test('falls back for a centroid off-screen in latitude only', () => {
        expect(selectionTooltipAnchor({ lat: 5, lng: -95 }, view)).toEqual({
            lat: 35,
            lng: -95,
        })
    })

    test('normalizes a view whose lat corners arrive swapped (rotated camera)', () => {
        const swapped = {
            southWest: { lat: 40, lng: -100 },
            northEast: { lat: 30, lng: -90 },
        }
        // Off the view's centre, so a kept centroid cannot be mistaken for the
        // fallback.
        const offCentre = { lat: 38, lng: -97 }
        expect(selectionTooltipAnchor(offCentre, swapped)).toEqual(offCentre)
        expect(selectionTooltipAnchor({ lat: 5, lng: -95 }, swapped)).toEqual({
            lat: 35,
            lng: -95,
        })
    })

    test('centres a view reported wider than a full turn on its middle', () => {
        const overwide = {
            southWest: { lat: 30, lng: 0 },
            northEast: { lat: 40, lng: 400 },
        }
        expect(selectionTooltipAnchor({ lat: 80, lng: 5 }, overwide)).toEqual({
            lat: 35,
            lng: 200,
        })
    })

    test('centres inside a view wrapped across the antimeridian', () => {
        const wrapped = {
            southWest: { lat: 30, lng: 170 },
            northEast: { lat: 40, lng: -170 },
        }
        expect(selectionTooltipAnchor({ lat: 58.4, lng: -139.3 }, wrapped)).toEqual({
            lat: 35,
            lng: 180,
        })
    })
})

test.describe('AOITool._applySelection camera behavior', () => {
    const mockApi = (currentView) => {
        const calls = []
        window.mmgisAPI = {
            request: vi.fn((name, payload) => {
                calls.push({ name, payload })
                return Promise.resolve(
                    name === 'map:getBounds' ? currentView : undefined
                )
            }),
            on: vi.fn(),
            off: vi.fn(),
        }
        return calls
    }
    const names = (calls) => calls.map((c) => c.name)

    beforeEach(() => {
        // The fitBounds path arms a 1500ms fallback timer that must not outlive
        // its test. `shouldAdvanceTime` keeps `flush()` working on fake timers.
        vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        delete window.mmgisAPI
        AOITool._state.currentAOI = null
    })

    test('makes no camera call and mounts the tooltip promptly when the selection is in view', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(squareFeature(-98, 32, -92, 38), 'draw', 'In view')
        await flush()
        expect(names(calls)).not.toContain('map:fitBounds')
        const overlay = calls.find((c) => c.name === 'map:addOverlay')
        // Anchored at the selection's own centroid — the view never moved, but
        // the centroid was already on-screen.
        expect(overlay?.payload.latlng).toEqual({ lat: 35, lng: -95 })
        expect(window.mmgisAPI.on).not.toHaveBeenCalledWith(
            'map:moveend',
            expect.anything()
        )
    })

    test('forwards the selection extent to map:fitBounds when it overflows the view', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(
            squareFeature(-98, 32, -80, 38),
            'search',
            'Beyond view'
        )
        await flush()
        expect(window.mmgisAPI.request).toHaveBeenCalledWith(
            'map:fitBounds',
            expect.objectContaining({
                bounds: [
                    { lat: 32, lng: -98 },
                    { lat: 38, lng: -80 },
                ],
            })
        )
        // The tooltip waits for the camera; this mock never fires moveend, so
        // the fallback timer mounts it — at the centroid, now framed.
        expect(names(calls)).not.toContain('map:addOverlay')
        vi.advanceTimersByTime(1600)
        await flush()
        const overlay = calls.find((c) => c.name === 'map:addOverlay')
        expect(overlay?.payload.latlng).toEqual({ lat: 35, lng: -89 })
    })

    test('anchors the tooltip inside the view when fitBounds is rejected', async () => {
        const calls = mockApi(view)
        const request = window.mmgisAPI.request
        window.mmgisAPI.request = vi.fn((name, payload) =>
            name === 'map:fitBounds'
                ? (calls.push({ name, payload }), Promise.reject(new Error('nope')))
                : request(name, payload)
        )
        AOITool._applySelection(
            squareFeature(-98, 32, -80, 38),
            'search',
            'Beyond view'
        )
        await flush()
        // The camera never moved, so the off-screen centroid (-89) would strand
        // the tooltip; it falls back to the centre of the unchanged view.
        const overlay = calls.find((c) => c.name === 'map:addOverlay')
        expect(overlay?.payload.latlng).toEqual({ lat: 35, lng: -95 })
    })

    test('anchors the tooltip inside the view for an unframeable selection (Alaska)', async () => {
        const calls = mockApi(view)
        // A ring straddling ±180, as Alaska's MultiPolygon does.
        AOITool._applySelection(
            squareFeature(179.77, 51.22, -179.17, 71.35),
            'inspect',
            'Alaska'
        )
        await flush()
        expect(names(calls)).not.toContain('map:fitBounds')
        const overlay = calls.find((c) => c.name === 'map:addOverlay')
        expect(overlay).toBeDefined()
        expect(overlay.payload.latlng).toEqual({ lat: 35, lng: -95 })
    })
})
