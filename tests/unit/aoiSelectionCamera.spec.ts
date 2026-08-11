import { test, expect, vi } from 'vitest'
import { selectionFitBounds } from '../../src/essence/Tools/AOI/aoiHelpers.ts'
import AOITool from '../../src/essence/Tools/AOI/AOITool.js'

// [w, s, e, n] bboxes against a 0..10 view.
const view = {
    southWest: { lat: 0, lng: 0 },
    northEast: { lat: 10, lng: 10 },
}

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
        expect(selectionFitBounds([2, 2, 8, 8], view)).toBeNull()
    })

    test('returns null for a selection exactly filling the view', () => {
        expect(selectionFitBounds([0, 0, 10, 10], view)).toBeNull()
    })

    test('fits a selection extending beyond the view', () => {
        const fit = selectionFitBounds([2, 2, 15, 8], view)
        expect(fit?.bounds).toEqual([
            { lat: 2, lng: 2 },
            { lat: 8, lng: 15 },
        ])
        // Modest margin, and never a maxZoom that binds on ordinary selections
        // (the old maxZoom: 5 clamped every commit out to a multi-state view).
        expect(fit?.options.padding).toBeLessThanOrEqual(60)
        expect(fit?.options.maxZoom).toBeGreaterThanOrEqual(16)
    })

    test('fits a fully off-screen selection', () => {
        expect(selectionFitBounds([20, 20, 25, 25], view)).not.toBeNull()
    })

    test('fits when the current view is unknown', () => {
        expect(selectionFitBounds([2, 2, 8, 8], null)).not.toBeNull()
    })

    test('returns null for zero-area extents', () => {
        expect(selectionFitBounds([5, 2, 5, 8], view)).toBeNull()
        expect(selectionFitBounds([2, 5, 8, 5], view)).toBeNull()
    })

    test('returns null for antimeridian-spanning naive sweeps (Alaska)', () => {
        expect(selectionFitBounds([-179.2, 51, 179.8, 71.4], view)).toBeNull()
    })
})

test.describe('AOITool._applySelection camera behavior', () => {
    const mockApi = (currentView) => {
        const calls = []
        window.mmgisAPI = {
            request: vi.fn((name) => {
                calls.push(name)
                return Promise.resolve(
                    name === 'map:getBounds' ? currentView : undefined
                )
            }),
            on: vi.fn(),
            off: vi.fn(),
        }
        return calls
    }

    test('makes no camera call and mounts the tooltip promptly when the selection is in view', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(squareFeature(2, 2, 8, 8), 'draw', 'In view')
        await flush()
        expect(calls).not.toContain('map:fitBounds')
        expect(calls).toContain('map:addOverlay')
        expect(window.mmgisAPI.on).not.toHaveBeenCalledWith(
            'map:moveend',
            expect.anything()
        )
    })

    test('issues a minimal fitBounds when the selection extends beyond the view', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(squareFeature(2, 2, 15, 8), 'search', 'Beyond view')
        await flush()
        expect(calls).toContain('map:fitBounds')
    })
})
