import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    featureCentroid,
    selectionFitBounds,
    selectionPopupAnchor,
} from '../../src/essence/Tools/AOI/aoiHelpers.ts'
import AOITool from '../../src/essence/Tools/AOI/AOITool.js'

// Deliberately asymmetric: a check that swapped lat and lng, or that ignored
// one of the two axes, gets the wrong answer here instead of landing on the
// right one by accident.
const view = {
    southWest: { lat: 30, lng: -100 },
    northEast: { lat: 40, lng: -90 },
}

// Alaska's bundled boundary. It has parts on either side of ±180, so the naive
// sweep across it is ~359° wide, and the vertex-mean centroid lands at -139° —
// well outside a view of the lower 48.
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
        // A modest margin, and a maxZoom high enough that an ordinary
        // selection never reaches it.
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

    test('treats a view reported wider than a full turn as containing every longitude', () => {
        // Zoomed out in a wide container, standalone deck.gl boxes its corners
        // without wrapping them, so it reports more than the whole world on
        // screen.
        const overwide = {
            southWest: { lat: 30, lng: -292 },
            northEast: { lat: 40, lng: 292 },
        }
        // 63 sits exactly a full turn east of the west edge. Folding that
        // offset into [0, 360) reads it as 355, which would zoom in on a
        // boundary that is already visible.
        expect(selectionFitBounds([63, 32, 73, 38], overwide)).toBeNull()
        // Latitude still decides.
        expect(selectionFitBounds([63, 10, 73, 20], overwide)).not.toBeNull()
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

test.describe('featureCentroid', () => {
    const geometry = (type, coordinates) => ({
        type: 'Feature',
        properties: {},
        geometry: { type, coordinates },
    })

    test('averages a polygon ring, counting its repeated closing vertex once', () => {
        expect(featureCentroid(squareFeature(0, 0, 10, 20))).toEqual([5, 10])
    })

    // `drawShapes: linestring` is a supported mission config, and the popup
    // card holds the only Analyze and Cancel a selection has — no centroid, no
    // card, and the drawn line cannot be analyzed or cleared.
    test('averages a linestring, which is what a drawn line selects on', () => {
        expect(
            featureCentroid(geometry('LineString', [[0, 0], [10, 4], [20, 8]]))
        ).toEqual([10, 4])
    })

    test('averages every part of a multilinestring', () => {
        expect(
            featureCentroid(
                geometry('MultiLineString', [
                    [[0, 0], [2, 0]],
                    [[0, 4], [2, 4]],
                ])
            )
        ).toEqual([1, 2])
    })

    test('has no centroid for a geometry with no vertices to average', () => {
        expect(featureCentroid(geometry('LineString', []))).toBeNull()
        expect(featureCentroid({ type: 'Feature', properties: {} })).toBeNull()
    })
})

test.describe('selectionPopupAnchor', () => {
    const centroid = { lat: 35, lng: -95 }

    test('keeps a centroid that is inside the view', () => {
        expect(selectionPopupAnchor(centroid, view)).toEqual(centroid)
    })

    test('keeps the centroid when no view is supplied (camera was fitted)', () => {
        expect(selectionPopupAnchor(centroid)).toEqual(centroid)
    })

    test('falls back to the view centre for an off-screen centroid (Alaska)', () => {
        expect(selectionPopupAnchor({ lat: 58.4, lng: -139.3 }, view)).toEqual({
            lat: 35,
            lng: -95,
        })
    })

    test('falls back for a centroid off-screen in latitude only', () => {
        expect(selectionPopupAnchor({ lat: 5, lng: -95 }, view)).toEqual({
            lat: 35,
            lng: -95,
        })
    })

    test('centres a view reported wider than a full turn on its middle', () => {
        const overwide = {
            southWest: { lat: 30, lng: 0 },
            northEast: { lat: 40, lng: 400 },
        }
        expect(selectionPopupAnchor({ lat: 80, lng: 5 }, overwide)).toEqual({
            lat: 35,
            lng: 200,
        })
    })

    test('centres inside a view wrapped across the antimeridian', () => {
        const wrapped = {
            southWest: { lat: 30, lng: 170 },
            northEast: { lat: 40, lng: -170 },
        }
        expect(selectionPopupAnchor({ lat: 58.4, lng: -139.3 }, wrapped)).toEqual({
            lat: 35,
            lng: 180,
        })
    })
})

test.describe('AOITool._applySelection camera behavior', () => {
    const mockApi = (currentView) => {
        const calls = []
        window.mmgisAPI = {
            // Core's own signature: the caller travels in an options object,
            // and core refuses a bare id in that slot outright. Recording it
            // unwrapped is what keeps `calls` reading as a plain caller.
            request: vi.fn((name, payload, options) => {
                calls.push({ name, payload, caller: options?.caller })
                return Promise.resolve(
                    name === 'map:getBounds' ? currentView : undefined
                )
            }),
            on: vi.fn(),
            off: vi.fn(),
        }
        // Every request goes through the plugin's handle, which is what stamps
        // it with the plugin's id.
        window.mmgisAPI.forPlugin = (pluginId) => ({
            emit: () => { },
            provide: () => () => { },
            request: (name, data) =>
                window.mmgisAPI.request(name, data, { caller: pluginId }),
        })
        // These specs drive `_applySelection` on its own rather than through
        // `make()`, so hand the tool the handle `make()` would have given it.
        AOITool._api = window.mmgisAPI.forPlugin('aoi')
        return calls
    }
    const names = (calls) => calls.map((c) => c.name)

    beforeEach(() => {
        // The fitBounds path sets a 1500ms fallback timer that must not outlive
        // its test. `shouldAdvanceTime` keeps `flush()` working under fake
        // timers.
        vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        delete window.mmgisAPI
        AOITool._api = null
        AOITool._state.currentAOI = null
    })

    test('makes no camera call and opens the popup promptly when the selection is in view', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(squareFeature(-98, 32, -92, 38), 'draw', 'In view')
        await flush()
        expect(names(calls)).not.toContain('map:fitBounds')
        const popup = calls.find((c) => c.name === 'map:showPopup')
        // Anchored at the selection's own centroid — the view never moved, but
        // the centroid was already on-screen.
        expect(popup?.payload.latlng).toEqual({ lat: 35, lng: -95 })
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
            }),
            { caller: 'aoi' }
        )
        // The popup waits for the camera; this mock never fires moveend, so
        // the fallback timer mounts it — at the centroid, now framed.
        expect(names(calls)).not.toContain('map:showPopup')
        vi.advanceTimersByTime(1600)
        await flush()
        const popup = calls.find((c) => c.name === 'map:showPopup')
        expect(popup?.payload.latlng).toEqual({ lat: 35, lng: -89 })
    })

    test('opens the popup on moveend and unhooks the handler', async () => {
        const calls = mockApi(view)
        AOITool._applySelection(
            squareFeature(-98, 32, -80, 38),
            'search',
            'Beyond view'
        )
        await flush()
        const [event, onMoveend] = window.mmgisAPI.on.mock.calls[0]
        expect(event).toBe('map:moveend')
        expect(names(calls)).not.toContain('map:showPopup')

        // Map_ re-emits moveend with the engine's view state, so the handler
        // must drop that payload rather than pass it on as a ViewBounds. The
        // numbers in it are nowhere near the selection's centroid, so a
        // handler that read the card's anchor off them would be caught here.
        onMoveend({ longitude: 12, latitude: -4, zoom: 6 })
        // At the centroid: the camera has framed the selection, so no anchor
        // fallback applies.
        expect(
            calls.find((c) => c.name === 'map:showPopup')?.payload.latlng
        ).toEqual({ lat: 35, lng: -89 })
        expect(window.mmgisAPI.off).toHaveBeenCalledWith(
            'map:moveend',
            onMoveend
        )
        // The fallback timer is disarmed, so it cannot open a second popup.
        vi.advanceTimersByTime(1600)
        await flush()
        expect(calls.filter((c) => c.name === 'map:showPopup')).toHaveLength(1)
    })

    test('anchors the popup inside the view when fitBounds is rejected', async () => {
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
        // the popup; it falls back to the centre of the unchanged view.
        const popup = calls.find((c) => c.name === 'map:showPopup')
        expect(popup?.payload.latlng).toEqual({ lat: 35, lng: -95 })
    })

    test('drops a fitBounds rejection that lands after a superseding selection', async () => {
        const calls = mockApi(view)
        const request = window.mmgisAPI.request
        // Hold each fit open, so the first selection's rejection can be made to
        // arrive after the second selection has already replaced it.
        const rejectFit = []
        window.mmgisAPI.request = vi.fn((name, payload, options) => {
            if (name !== 'map:fitBounds') return request(name, payload, options)
            calls.push({ name, payload, caller: options?.caller })
            return new Promise((_resolve, reject) => rejectFit.push(reject))
        })

        AOITool._applySelection(squareFeature(-98, 32, -80, 38), 'search', 'First')
        await flush()
        AOITool._applySelection(squareFeature(-98, 20, -80, 45), 'search', 'Second')
        await flush()

        const [, secondMoveend] = window.mmgisAPI.on.mock.calls[1]

        rejectFit[0](new Error('nope'))
        await flush()

        // The stale show stays shut: its selection is gone from the map and
        // from `currentAOI`, so its popup would offer to analyze an area the
        // user has already replaced.
        expect(names(calls)).not.toContain('map:showPopup')
        // And it leaves the current selection's show armed. Disarming that one
        // is the worse half of the failure: the popup the user is waiting for
        // never opens at all.
        expect(window.mmgisAPI.off).not.toHaveBeenCalledWith(
            'map:moveend',
            secondMoveend
        )

        secondMoveend({ longitude: -89, latitude: 32.5, zoom: 5 })
        const popups = calls.filter((c) => c.name === 'map:showPopup')
        expect(popups).toHaveLength(1)
        expect(popups[0].payload.title).toBe('Second')
        expect(popups[0].payload.latlng).toEqual({ lat: 32.5, lng: -89 })
    })

    test('anchors the popup inside the view for an unframeable selection (Alaska)', async () => {
        const calls = mockApi(view)
        // A ring straddling ±180, as Alaska's MultiPolygon does.
        AOITool._applySelection(
            squareFeature(179.77, 51.22, -179.17, 71.35),
            'inspect',
            'Alaska'
        )
        await flush()
        expect(names(calls)).not.toContain('map:fitBounds')
        const popup = calls.find((c) => c.name === 'map:showPopup')
        expect(popup).toBeDefined()
        expect(popup.payload.latlng).toEqual({ lat: 35, lng: -95 })
    })
})
