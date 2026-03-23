import { test, expect } from '@playwright/test'
import LeafletAdapter from '../../src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'


/**
 * LeafletAdapter Unit Tests
 *
 * Tests the real LeafletAdapter class with a mocked global `L` (Leaflet)
 * and a mocked DOM, so no real browser or Leaflet build is needed.
 *
 * Covers:
 *  - Lifecycle: init, destroy, getNativeMap, getContainer
 *  - View Control: setView, setZoom, setCenter, getZoom, getCenter
 */

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeMockLeafletMap() {
    return {
        _zoom: 2,
        _center: { lat: 0, lng: 0 },
        setView: function (center, zoom) {
            this._center = { lat: center[0], lng: center[1] }
            this._zoom = zoom
        },
        setZoom: function (zoom) { this._zoom = zoom },
        getZoom: function () { return this._zoom },
        getCenter: function () { return this._center },
        getMinZoom: function () { return 0 },
        getMaxZoom: function () { return 20 },
        setMinZoom: function () { },
        setMaxZoom: function () { },
        invalidateSize: function () { },
        getSize: function () { return { x: 800, y: 600 } },
        zoomControl: { setPosition: function () { } },
        off: function () { },
        on: function () { },
        remove: function () { },
        hasLayer: function () { return false },
        addLayer: function () { },
        removeLayer: function () { },
        project: function () { return { x: 0, y: 0 } },
        unproject: function () { return { lat: 0, lng: 0 } },
        containerPointToLatLng: function () { return { lat: 0, lng: 0 } },
        latLngToContainerPoint: function () { return { x: 0, y: 0 } },
        flyTo: function () { },
        panTo: function () { },
        fitBounds: function () { },
        setMaxBounds: function () { },
        fire: function () { },
    }
}

function setup() {
    const fakeContainer = { querySelector: () => null }
    const mockMap = makeMockLeafletMap()

    global.document = {
        getElementById: (id) => (id === 'map' ? fakeContainer : null),
    }

    global.L = {
        map: () => mockMap,
        Proj: { CRS: function () { return { projString: '' } } },
        bounds: () => ({}),
    }

    return { mockMap, fakeContainer }
}

// ─── Lifecycle Tests ──────────────────────────────────────────────────────────

test.describe('LeafletAdapter - Lifecycle', () => {

    test('engineType is MAP_ENGINE.LEAFLET', () => {
        setup()
        const adapter = new LeafletAdapter()
        expect(adapter.engineType).toBe(MAP_ENGINE.LEAFLET)
    })

    test('init() creates a Leaflet map and stores it internally', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map' })

        expect(adapter.getNativeMap()).toBe(mockMap)
    })

    test('init() throws if container element is not found', () => {
        setup()
        const adapter = new LeafletAdapter()

        expect(() => {
            adapter.init({ containerId: 'nonexistent-id' })
        }).toThrow('Container element with id "nonexistent-id" not found')
    })

    test('init() sets initial view with provided center and zoom', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map', center: { lat: 39.8, lng: -98.5 }, zoom: 5 })

        expect(mockMap._center).toEqual({ lat: 39.8, lng: -98.5 })
        expect(mockMap._zoom).toBe(5)
    })

    test('init() defaults to center [0,0] zoom 2 when not provided', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map' })

        expect(mockMap._center).toEqual({ lat: 0, lng: 0 })
        expect(mockMap._zoom).toBe(2)
    })

    test('getNativeMap() returns null before init', () => {
        setup()
        const adapter = new LeafletAdapter()

        expect(adapter.getNativeMap()).toBeNull()
    })

    test('getContainer() returns the DOM element after init', () => {
        const { fakeContainer } = setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map' })

        expect(adapter.getContainer()).toBe(fakeContainer)
    })

    test('destroy() clears the map instance', () => {
        setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map' })
        adapter.destroy()

        expect(adapter.getNativeMap()).toBeNull()
    })

    test('destroy() is safe to call when map is not initialized', () => {
        setup()
        const adapter = new LeafletAdapter()

        expect(() => adapter.destroy()).not.toThrow()
    })

    test('calling init() twice destroys the old map first without throwing', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()

        adapter.init({ containerId: 'map' })
        adapter.init({ containerId: 'map' })

        expect(adapter.getNativeMap()).toBe(mockMap)
    })
})

// ─── View Control Tests ───────────────────────────────────────────────────────

test.describe('LeafletAdapter - View Control', () => {

    test('setView() updates center and zoom', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.setView({ lat: 51.5, lng: -0.1 }, 10)

        expect(mockMap._center).toEqual({ lat: 51.5, lng: -0.1 })
        expect(mockMap._zoom).toBe(10)
    })

    test('setView() accepts array format [lat, lng]', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.setView([48.8, 2.3], 8)

        expect(mockMap._center).toEqual({ lat: 48.8, lng: 2.3 })
        expect(mockMap._zoom).toBe(8)
    })

    test('setView() uses current zoom when zoom not provided', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map', zoom: 7 })

        adapter.setView({ lat: 0, lng: 0 })

        expect(mockMap._zoom).toBe(7)
    })

    test('setZoom() updates only the zoom level', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map', center: { lat: 10, lng: 20 }, zoom: 3 })

        adapter.setZoom(12)

        expect(mockMap._zoom).toBe(12)
    })

    test('setCenter() updates only the center, zoom unchanged', () => {
        const { mockMap } = setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map', center: { lat: 0, lng: 0 }, zoom: 5 })

        adapter.setCenter({ lat: 34.0, lng: -118.2 })

        expect(mockMap._center).toEqual({ lat: 34.0, lng: -118.2 })
        expect(mockMap._zoom).toBe(5)
    })

    test('getZoom() returns the current zoom level', () => {
        setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map', zoom: 9 })

        expect(adapter.getZoom()).toBe(9)
    })

    test('getCenter() returns the current center as {lat, lng}', () => {
        setup()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map', center: { lat: 39.8, lng: -98.5 } })

        const center = adapter.getCenter()

        expect(center).toHaveProperty('lat', 39.8)
        expect(center).toHaveProperty('lng', -98.5)
    })
})
