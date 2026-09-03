import { test, expect, vi } from 'vitest'
import LeafletAdapter from '../../src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'
import { getMapScreenshot as mockedLeafletCapture } from '../../src/essence/Basics/MapEngines/Adapters/LeafletScreenshot.js'

// Mock the Leaflet screenshot strategy so we can assert LeafletAdapter delegates
// to it (issue #143) without driving the real html2canvas/DOM path.
vi.mock('../../src/essence/Basics/MapEngines/Adapters/LeafletScreenshot.js', () => {
    const result = {
        blob: new Blob(['leaflet'], { type: 'image/png' }),
        mimeType: 'image/png',
        extension: 'png',
        width: 640,
        height: 480,
    }
    const fn = vi.fn(() => Promise.resolve(result))
    return { getMapScreenshot: fn, default: fn }
})


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

    test('captureScreenshot() delegates to the Leaflet screenshot strategy', async () => {
        // The engine-aware screenshot path (issue #143) requires every adapter
        // to implement captureScreenshot(). LeafletAdapter delegates to the
        // Leaflet screenshot helper; assert it actually calls it and returns the
        // helper's promise (not just that the method exists).
        const adapter = new LeafletAdapter()
        expect(typeof adapter.captureScreenshot).toBe('function')

        mockedLeafletCapture.mockClear()
        const result = await adapter.captureScreenshot()

        expect(mockedLeafletCapture).toHaveBeenCalledTimes(1)
        expect(result.mimeType).toBe('image/png')
        expect(result.extension).toBe('png')
        expect(result.width).toBe(640)
        expect(result.height).toBe(480)
        expect(result.blob).toBeInstanceOf(Blob)
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

// ─── Helpers shared by layer tests ───────────────────────────────────────────

function makeMockTileLayer() {
    return {
        _type: 'tile',
        _opacity: 1,
        _zIndex: 0,
        _url: '',
        setOpacity: function (v) { this._opacity = v },
        setZIndex: function (v) { this._zIndex = v },
        setUrl: function (v) { this._url = v },
    }
}

function makeMockGeoJSONLayer() {
    return {
        _type: 'geojson',
        _style: null,
        setStyle: function (v) { this._style = v },
    }
}

function setupWithLayerMocks() {
    const { mockMap, fakeContainer } = setup()

    const mockTile = makeMockTileLayer()
    const mockGeoJSON = makeMockGeoJSONLayer()

    global.L.tileLayer = () => mockTile
    global.L.geoJSON = () => mockGeoJSON

    const addedLayers = []
    const removedLayers = []
    mockMap.addLayer = function (l) { addedLayers.push(l) }
    mockMap.removeLayer = function (l) { removedLayers.push(l) }
    mockMap.hasLayer = function (l) {
        return addedLayers.includes(l) && !removedLayers.includes(l)
    }

    return { mockMap, fakeContainer, mockTile, mockGeoJSON, addedLayers, removedLayers }
}

// ─── createLayer: tile ───────────────────────────────────────────────────────

test.describe('LeafletAdapter - createLayer (tile)', () => {

    test('creates a tile layer and adds it to the map', () => {
        const { mockTile, addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const layer = adapter.createLayer({ id: 'basemap', type: 'tile', url: 'https://example.com/{z}/{x}/{y}.png' })

        expect(layer).toBe(mockTile)
        expect(addedLayers).toContain(mockTile)
    })

    test('tile layer defaults tms to true', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let capturedOptions = null
        global.L.tileLayer = (url, opts) => { capturedOptions = opts; return mockTile }

        adapter.createLayer({ id: 'tms', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        expect(capturedOptions.tms).toBe(true)
    })

    test('tile layer with tms:false (WMS/WMTS)', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let capturedOptions = null
        global.L.tileLayer = (url, opts) => { capturedOptions = opts; return mockTile }

        adapter.createLayer({ id: 'wms', type: 'tile', url: 'https://x.com/wms', tms: false })
        expect(capturedOptions.tms).toBe(false)
    })

    test('tile layer applies initial opacity', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'op', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png', opacity: 0.5 })
        expect(mockTile._opacity).toBe(0.5)
    })

    test('tile layer with visible:false is NOT added to map', () => {
        const { mockTile, addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'hidden', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png', visible: false })
        expect(addedLayers).not.toContain(mockTile)
    })

    test('createLayer throws when id is missing', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.createLayer({ type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        ).toThrow('options.id is required')
    })

    test('createLayer throws for unsupported layer type', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.createLayer({ id: 'bad', type: 'unknown' })
        ).toThrow('unsupported layer type')
    })

    test('nativeOptions are forwarded to L.tileLayer', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let capturedOptions = null
        global.L.tileLayer = (url, opts) => { capturedOptions = opts; return mockTile }

        adapter.createLayer({
            id: 'native',
            type: 'tile',
            url: 'https://x.com/{z}/{x}/{y}.png',
            nativeOptions: { crossOrigin: 'anonymous' },
        })
        expect(capturedOptions.crossOrigin).toBe('anonymous')
    })
})

// ─── createLayer: GeoJSON / vector ──────────────────────────────────────────

test.describe('LeafletAdapter - createLayer (vector)', () => {

    const sampleGeoJSON = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }],
    }

    test('creates a GeoJSON layer and adds it to the map', () => {
        const { mockGeoJSON, addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const layer = adapter.createLayer({ id: 'geo', type: 'vector', geojson: sampleGeoJSON })

        expect(layer).toBe(mockGeoJSON)
        expect(addedLayers).toContain(mockGeoJSON)
    })

    test('style callback is forwarded to L.geoJSON', () => {
        const { mockGeoJSON } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const styleFn = () => ({ color: 'red' })
        let capturedOptions = null
        global.L.geoJSON = (data, opts) => { capturedOptions = opts; return mockGeoJSON }

        adapter.createLayer({ id: 'styled', type: 'vector', geojson: sampleGeoJSON, style: styleFn })
        expect(capturedOptions.style).toBe(styleFn)
    })

    test('createLayer (vector) throws when geojson is missing', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.createLayer({ id: 'no-data', type: 'vector' })
        ).toThrow('options.geojson is required')
    })
})

// ─── addLayer backward compatibility ────────────────────────────────────────

test.describe('LeafletAdapter - addLayer (backward compatibility)', () => {

    test('raw Leaflet layer (has _leaflet_id) is forwarded directly to the native map', () => {
        const { addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const rawLayer = { _leaflet_id: 42 }
        adapter.addLayer(rawLayer)

        expect(addedLayers).toContain(rawLayer)
    })

    test('LayerOptions spec passed to addLayer() delegates to createLayer()', () => {
        const { mockTile, addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.addLayer({ id: 'via-addLayer', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })

        expect(adapter.hasLayer('via-addLayer')).toBe(true)
        expect(addedLayers).toContain(mockTile)
    })
})

// ─── hasLayer ────────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - hasLayer', () => {

    // registerLayer holds every MMGIS-built tile layer whether or not it is on
    // the map, so a registry hit is not the answer. Both forms ask the map, and
    // must give the same one — mmgisAPI's `map:hasLayer` exposes it publicly.
    test('a registered layer that is not on the map reports false either way', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const layer = { _leaflet_id: 7 }
        adapter.registerLayer('off-map', layer)

        expect(adapter.hasLayer('off-map')).toBe(false)
        expect(adapter.hasLayer(layer)).toBe(false)
    })

    test('both forms report true once the layer is on the map', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const layer = { _leaflet_id: 7 }
        adapter.registerLayer('on-map', layer)
        adapter.addLayer(layer)

        expect(adapter.hasLayer('on-map')).toBe(true)
        expect(adapter.hasLayer(layer)).toBe(true)
    })

    test('an id the adapter never saw reports false rather than throwing', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(adapter.hasLayer('never-seen')).toBe(false)
    })
})

// ─── removeLayer ─────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - removeLayer', () => {

    // Map_.rmNotNull removes by object on every toggle-off, and a toggled-off
    // layer still has to be refreshable — TimeControl.reloadLayer's `evenIfOff`
    // path depends on it — so the object form deliberately keeps the entry.
    test('removing by object keeps the registration', () => {
        const { removedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const layer = { _leaflet_id: 9, refresh: vi.fn() }
        adapter.registerLayer('toggled-off', layer)
        adapter.addLayer(layer)

        adapter.removeLayer(layer)

        expect(removedLayers).toContain(layer)
        expect(adapter.hasLayer('toggled-off')).toBe(false)
        expect(adapter.refreshLayer('toggled-off', { url: 'u' })).toBe(true)
        expect(layer.refresh).toHaveBeenCalled()
    })

    test('removes a layer by string ID and cleans up the registry', () => {
        const { removedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'rm-me', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        expect(adapter.hasLayer('rm-me')).toBe(true)

        adapter.removeLayer('rm-me')

        expect(adapter.hasLayer('rm-me')).toBe(false)
        expect(removedLayers.length).toBeGreaterThan(0)
    })

    test('removing a non-existent id is a no-op', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() => adapter.removeLayer('does-not-exist')).not.toThrow()
    })
})

// ─── updateLayer ─────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - updateLayer', () => {

    test('updates opacity on a tile layer', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'op-tile', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        adapter.updateLayer('op-tile', { opacity: 0.3 })

        expect(mockTile._opacity).toBe(0.3)
    })

    test('hides a layer by setting visible:false', () => {
        const { mockTile, removedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'show-hide', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        adapter.updateLayer('show-hide', { visible: false })

        expect(removedLayers).toContain(mockTile)
    })

    test('shows a hidden layer by setting visible:true', () => {
        const { mockTile, addedLayers } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'hidden-show', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png', visible: false })
        const countBefore = addedLayers.length

        adapter.updateLayer('hidden-show', { visible: true })

        expect(addedLayers.length).toBeGreaterThan(countBefore)
        expect(addedLayers).toContain(mockTile)
    })

    test('updates style on a GeoJSON layer', () => {
        const { mockGeoJSON } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'geo-style', type: 'vector', geojson: { type: 'FeatureCollection', features: [] } })
        adapter.updateLayer('geo-style', { style: { color: 'blue' } })

        expect(mockGeoJSON._style).toEqual({ color: 'blue' })
    })

    test('updates url on a tile layer', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'url-tile', type: 'tile', url: 'https://old.com/{z}/{x}/{y}.png' })
        adapter.updateLayer('url-tile', { url: 'https://new.com/{z}/{x}/{y}.png' })

        expect(mockTile._url).toBe('https://new.com/{z}/{x}/{y}.png')
    })

    test('updateLayer throws when layer id is not found', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.updateLayer('ghost', { opacity: 1 })
        ).toThrow('no layer found with id "ghost"')
    })

    test('updateLayer returns the native Leaflet layer', () => {
        const { mockTile } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.createLayer({ id: 'ret', type: 'tile', url: 'https://x.com/{z}/{x}/{y}.png' })
        const returned = adapter.updateLayer('ret', { opacity: 0.8 })

        expect(returned).toBe(mockTile)
    })
})

// ─── Marker helpers ───────────────────────────────────────────────────────────

function makeMockCircleMarker() {
    return {
        _type: 'circleMarker',
        _latlng: null,
        _zIndexOffset: 0,
        _dragging: false,
        setLatLng: function (ll) { this._latlng = ll },
        setZIndexOffset: function (v) { this._zIndexOffset = v },
        dragging: {
            enable: function () { },
            disable: function () { },
        },
    }
}

function makeMockIconMarker() {
    return {
        _type: 'marker',
        _latlng: null,
        _icon: null,
        setLatLng: function (ll) { this._latlng = ll },
        setIcon: function (icon) { this._icon = icon },
        setZIndexOffset: function (v) { this._zIndexOffset = v },
        dragging: {
            enable: function () { },
            disable: function () { },
        },
    }
}

function setupWithMarkerMocks() {
    const base = setupWithLayerMocks()
    const mockCircle = makeMockCircleMarker()
    const mockIcon = makeMockIconMarker()

    global.L.circleMarker = (latlng) => { mockCircle._latlng = latlng; return mockCircle }
    global.L.marker = (latlng) => { mockIcon._latlng = latlng; return mockIcon }
    global.L.icon = (opts) => ({ _iconUrl: opts.iconUrl })

    return { ...base, mockCircle, mockIcon }
}

// ─── addMarker ────────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - addMarker', () => {

    test('creates a circleMarker by default and adds it to the map', () => {
        const { mockCircle, addedLayers } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const marker = adapter.addMarker({ id: 'cm', position: { lat: 10, lng: 20 } })

        expect(marker).toBe(mockCircle)
        expect(addedLayers).toContain(mockCircle)
    })

    test('creates an icon marker when icon.url is provided', () => {
        const { mockIcon, addedLayers } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const marker = adapter.addMarker({
            id: 'im',
            position: { lat: 10, lng: 20 },
            icon: { url: 'https://example.com/icon.png' },
        })

        expect(marker).toBe(mockIcon)
        expect(addedLayers).toContain(mockIcon)
    })

    test('addMarker throws when id is missing', () => {
        setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.addMarker({ position: { lat: 0, lng: 0 } })
        ).toThrow('options.id is required')
    })

    test('addMarker throws when position is missing', () => {
        setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.addMarker({ id: 'no-pos' })
        ).toThrow('options.position is required')
    })
})

// ─── removeMarker ─────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - removeMarker', () => {

    test('removes a marker by string ID and cleans up registry', () => {
        const { removedLayers } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.addMarker({ id: 'rm', position: { lat: 0, lng: 0 } })
        adapter.removeMarker('rm')

        expect(removedLayers.length).toBeGreaterThan(0)
    })

    test('removing a non-existent id is a no-op', () => {
        setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() => adapter.removeMarker('ghost')).not.toThrow()
    })
})

// ─── updateMarker ─────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - updateMarker', () => {

    test('updates marker position', () => {
        const { mockCircle } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.addMarker({ id: 'mv', position: { lat: 0, lng: 0 } })
        adapter.updateMarker('mv', { position: { lat: 5, lng: 10 } })

        expect(mockCircle._latlng).toEqual([5, 10])
    })

    test('updates zIndexOffset', () => {
        const { mockCircle } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.addMarker({ id: 'zi', position: { lat: 0, lng: 0 } })
        adapter.updateMarker('zi', { zIndexOffset: 999 })

        expect(mockCircle._zIndexOffset).toBe(999)
    })

    test('updateMarker throws when id is not found', () => {
        setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        expect(() =>
            adapter.updateMarker('ghost', { position: { lat: 0, lng: 0 } })
        ).toThrow('no marker found with id "ghost"')
    })

    test('updateMarker returns the native Leaflet marker', () => {
        const { mockCircle } = setupWithMarkerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        adapter.addMarker({ id: 'ret', position: { lat: 0, lng: 0 } })
        const returned = adapter.updateMarker('ret', { zIndexOffset: 1 })

        expect(returned).toBe(mockCircle)
    })
})

// ─── onFeatureClick ───────────────────────────────────────────────────────────

test.describe('LeafletAdapter - onFeatureClick', () => {

    test('registers a click handler on the map', () => {
        const { mockMap } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let clickHandlerRegistered = false
        mockMap.on = (event) => { if (event === 'click') clickHandlerRegistered = true }

        adapter.onFeatureClick(() => { })

        expect(clickHandlerRegistered).toBe(true)
    })

    test('calls handler with feature: null when no vector layers match', () => {
        const { mockMap } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let capturedResult = null
        let clickCallback = null
        mockMap.on = (event, cb) => { if (event === 'click') clickCallback = cb }

        adapter.onFeatureClick((result) => { capturedResult = result })
        clickCallback({ latlng: { lat: 0, lng: 0 }, containerPoint: { x: 0, y: 0 } })

        expect(capturedResult.feature).toBeNull()
    })
})

// ─── on / off ─────────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - on / off', () => {

    // Click subscribers hang off the adapter's own map listener rather than
    // off Leaflet, so unsubscribing has to take them off that fan-out — handing
    // the handler back to Leaflet cannot remove a listener Leaflet never had.
    test('off() stops a click subscriber the adapter fans out to', () => {
        const { mockMap } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let mapClick = null
        mockMap.on = (event, cb) => { if (event === 'click') mapClick = cb }

        const clicks = []
        const handler = (e) => clicks.push(e.latlng)
        adapter.on('click', handler)
        mapClick({ latlng: { lat: 1, lng: 2 } })

        adapter.off('click', handler)
        mapClick({ latlng: { lat: 3, lng: 4 } })

        expect(clicks).toEqual([{ lat: 1, lng: 2 }])
    })
})

// ─── the click a drawing ended on ─────────────────────────────────────────────

test.describe('LeafletAdapter - the click a drawing ended on', () => {

    /**
     * Stands in for the map container terra-draw and the guard listen on.
     * Removal matches on the capture flag the way the DOM does, so a listener
     * taken off with the other one stays attached. `fire` dispatches an event
     * object, so the guard sees the same one Leaflet will later hand over.
     */
    function makeEventTarget() {
        const listeners = []
        return {
            addEventListener: (type, fn, capture = false) => {
                listeners.push({ type, fn, capture: !!capture })
            },
            removeEventListener: (type, fn, capture = false) => {
                const i = listeners.findIndex(
                    (l) => l.type === type && l.fn === fn && l.capture === !!capture
                )
                if (i !== -1) listeners.splice(i, 1)
            },
            fire: (event) => {
                listeners
                    .filter((l) => l.type === event.type)
                    .forEach((l) => l.fn(event))
            },
            listenerCount: () => listeners.length,
        }
    }

    /** A DOM event stamped as the browser would stamp one made at `timeStamp`. */
    function stamped(type, timeStamp) {
        const event = new Event(type)
        Object.defineProperty(event, 'timeStamp', { value: timeStamp })
        return event
    }

    /** The map's double-click zoom handler, reporting the state it is left in. */
    function makeDoubleClickZoom() {
        let enabled = false
        return {
            enabled: () => enabled,
            enable: () => { enabled = true },
            disable: () => { enabled = false },
        }
    }

    /**
     * Stands in for terra-draw, which turns double-click zoom back on as it
     * stops the mode — and throws rather than stopping a mode twice, leaving
     * whatever it stopped the first time in place.
     */
    function makeTerraDraw(doubleClickZoom, { started = true } = {}) {
        return {
            clear: () => { },
            stop: () => {
                if (!started) throw new Error('Mode must be started to be stopped')
                started = false
                doubleClickZoom.enable()
            },
        }
    }

    /**
     * End a drawing session the way a click on the map does. terra-draw commits
     * from inside the pointerup, so the adapter's pointer watch is looking at
     * that very event as the session ends — which is what tells the guard a
     * click of the drawing's is still to come, and the stamp it will carry.
     */
    function stopOnPointer(adapter, at) {
        adapter._drawPointers.start()
        const stop = () => adapter._stopDrawing()
        window.addEventListener('pointerup', stop)
        window.dispatchEvent(stamped('pointerup', at))
        window.removeEventListener('pointerup', stop)
    }

    /**
     * An adapter mid-rectangle, with the map's click subscribers captured so a
     * spec can deliver the click itself, carrying as `originalEvent` the
     * native click it came from — either an event object the container has
     * seen, or a bare stamp for one it has not.
     */
    function setupDrawing() {
        const { mockMap } = setupWithLayerMocks()
        const container = makeEventTarget()
        mockMap.getContainer = () => container
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const subscribers = new Map()
        mockMap.on = (event, cb) => {
            if (!subscribers.has(event)) subscribers.set(event, [])
            subscribers.get(event).push(cb)
        }
        mockMap.fire = (event, data) => {
            subscribers.get(event)?.forEach((cb) => cb({ ...data, type: event }))
        }

        const clicks = []
        const picks = []
        adapter.on('click', (e) => clicks.push(e.latlng))
        adapter.onFeatureClick((result) => picks.push(result))
        adapter._drawingShape = 'rectangle'

        return {
            adapter,
            mockMap,
            container,
            clicks,
            picks,
            click: (source) =>
                mockMap.fire('click', {
                    latlng: { lat: 40, lng: -120 },
                    containerPoint: { x: 12, y: 34 },
                    originalEvent:
                        typeof source === 'number'
                            ? { type: 'click', timeStamp: source }
                            : source,
                }),
        }
    }

    // Nothing in Leaflet holds back the click that places a vertex: it fires a
    // map `click` for every native one, and terra-draw's Leaflet adapter never
    // stops click propagation. Reported, those clicks would dismiss whatever a
    // plugin has open and clear its selection halfway through a drawing — on
    // the 2D engine only, since DeckGLAdapter has always checked the session.
    test('a click placing a vertex mid-session is not reported', () => {
        const { clicks, picks, click } = setupDrawing()

        click(1000)

        expect(clicks).toEqual([])
        expect(picks).toEqual([])
    })

    // The session check must not reach past clicks: the drawing's own events
    // are emitted through this same wrapper while the session is live.
    test('a session does not hold back the drawing events themselves', () => {
        const { adapter } = setupDrawing()
        const vertices = []
        adapter.on('drawvertex', (e) => vertices.push(e.shape))

        adapter.emit('drawvertex', { shape: 'rectangle' })

        expect(vertices).toEqual(['rectangle'])
    })

    // terra-draw commits a shape on `pointerup`, and the native `click` that
    // finished it reaches Leaflet right after — by which time the session is
    // over. Reporting it hands every consumer a map click the user never made,
    // one that would dismiss the popup a plugin opened from the `drawcomplete`
    // that came first.
    test('is not reported as a map click', () => {
        const { adapter, container, clicks, picks, click } = setupDrawing()

        stopOnPointer(adapter, 1000)
        const native = stamped('click', 1000)
        container.fire(native)
        click(native)

        expect(clicks).toEqual([])
        expect(picks).toEqual([])
    })

    // "Right after" is only as soon as the main thread allows: the native click
    // is not dispatched until the pointerup's handlers return, and whatever a
    // `drawcomplete` subscriber set running holds it up. Nothing else can run
    // in between, so the click the container sees is still the drawing's.
    test('is not reported however late the native click is dispatched', () => {
        vi.useFakeTimers()
        try {
            const { adapter, container, clicks, click } = setupDrawing()

            stopOnPointer(adapter, 1000)
            vi.advanceTimersByTime(5000)
            const native = stamped('click', 1000)
            container.fire(native)
            click(native)

            expect(clicks).toEqual([])
        } finally {
            vi.useRealTimers()
        }
    })

    // The browser stamps a click with the pointerup it was made from, so a
    // click stamped with the finishing pointerup is the drawing's even when
    // the container never saw it go by.
    test('is not reported when only its stamp says it is the drawing\'s', () => {
        vi.useFakeTimers()
        try {
            const { adapter, clicks, click } = setupDrawing()

            stopOnPointer(adapter, 1000)
            vi.advanceTimersByTime(5000)
            click(1000)

            expect(clicks).toEqual([])
        } finally {
            vi.useRealTimers()
        }
    })

    // Finishing on a double-click is trained behaviour, and terra-draw commits
    // on the first of the two clicks. Leaflet has no double-click
    // disambiguation — `_fireDOMEvent` fires a map `click` for every native
    // click — so the second one arrives as an ordinary click, from a gesture
    // the user made to finish the drawing rather than to click the map.
    test('swallows both clicks of a double-click finish', () => {
        const { adapter, container, clicks, picks, click } = setupDrawing()

        // Tap 1: terra-draw commits on its pointerup, and the native click
        // that follows is the one the guard was first written for.
        stopOnPointer(adapter, 1000)
        const first = stamped('click', 1000)
        container.fire(first)
        click(first)

        // Tap 2, inside the tap interval that makes the pair a double-click.
        container.fire(stamped('pointerdown', 1150))
        container.fire(stamped('pointerup', 1200))
        const second = stamped('click', 1200)
        container.fire(second)
        click(second)

        expect(clicks).toEqual([])
        expect(picks).toEqual([])
    })

    // A pointer that goes down more than a tap interval after the finish is
    // the user's own next gesture, and its click is theirs — the container
    // sees it go by, but it is not recorded as the drawing's.
    test('reports the click of the user\'s next gesture', () => {
        const { adapter, container, clicks, picks, click } = setupDrawing()

        stopOnPointer(adapter, 1000)
        const first = stamped('click', 1000)
        container.fire(first)
        click(first)
        container.fire(stamped('pointerdown', 1400))
        container.fire(stamped('pointerup', 1450))
        const next = stamped('click', 1450)
        container.fire(next)
        click(next)

        expect(clicks).toEqual([{ lat: 40, lng: -120 }])
        expect(picks).toHaveLength(1)
    })

    // A click that came from no DOM event was no gesture of the drawing's.
    test('reports a click with no source event', () => {
        const { adapter, mockMap, clicks } = setupDrawing()

        stopOnPointer(adapter, 1000)
        mockMap.fire('click', {
            latlng: { lat: 40, lng: -120 },
            containerPoint: { x: 12, y: 34 },
        })

        expect(clicks).toEqual([{ lat: 40, lng: -120 }])
    })

    // The guard gives double-click zoom back, it does not hand it out: a map
    // that had it off — the session having ended with terra-draw already
    // stopped, so nothing turned it on — must still have it off once the
    // window closes. Enabling regardless would give every deployment that
    // configures double-click zoom off the behaviour it turned down, from the
    // user's first drawing to the end of the session.
    test('leaves double-click zoom off when it was off as the session ended', () => {
        vi.useFakeTimers()
        try {
            const { adapter, mockMap } = setupDrawing()
            const zoom = makeDoubleClickZoom()
            mockMap.doubleClickZoom = zoom
            adapter._terraDraw = makeTerraDraw(zoom, { started: false })

            stopOnPointer(adapter, 1000)
            vi.advanceTimersByTime(600)

            expect(zoom.enabled()).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    // Two sessions can end inside one window — a drawing cancelled, another
    // started and cancelled straight after — and the second arming reads the
    // handler again to know what to give back. By then the guard is the one
    // holding double-click zoom down, so what it reads must be the state from
    // before that: taking its own disable for the map's setting would leave
    // double-click zoom off for the rest of the session.
    test('gives back the double-click zoom state from before it held it down', () => {
        vi.useFakeTimers()
        try {
            const { adapter, mockMap } = setupDrawing()
            const zoom = makeDoubleClickZoom()
            mockMap.doubleClickZoom = zoom
            adapter._terraDraw = makeTerraDraw(zoom)

            stopOnPointer(adapter, 1000)
            expect(zoom.enabled()).toBe(false)

            // A second session, ending while the first hold is still on.
            vi.advanceTimersByTime(100)
            adapter._drawingShape = 'polygon'
            stopOnPointer(adapter, 1100)

            vi.advanceTimersByTime(600)
            expect(zoom.enabled()).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    // A mission swap tears the map down with a window still open. The guard
    // has to let go of the container it is watching — a removal that does not
    // match how it subscribed takes nothing off — and give double-click zoom
    // back on the way out, since nothing else will now that terra-draw's mode
    // is already stopped.
    test('lets go of the container and double-click zoom when the adapter is destroyed', () => {
        vi.useFakeTimers()
        try {
            const { adapter, mockMap, container } = setupDrawing()
            const zoom = makeDoubleClickZoom()
            mockMap.doubleClickZoom = zoom
            adapter._terraDraw = makeTerraDraw(zoom)

            stopOnPointer(adapter, 1000)
            expect(container.listenerCount()).toBe(3)
            expect(zoom.enabled()).toBe(false)

            adapter.destroy()

            expect(container.listenerCount()).toBe(0)
            expect(zoom.enabled()).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    // A plugin ending the drawing from its own panel — a Finish button, a
    // mode switch, the Escape it handles itself — never touched the map, so
    // the click the user makes next is theirs from the first one. The same
    // arm-with-no-recent-pointer path covers a session ended on Enter.
    test('a session a plugin ended does not swallow the click that follows', () => {
        const { adapter, clicks, picks, click } = setupDrawing()

        adapter.disableDrawing()
        click(5000)

        expect(clicks).toEqual([{ lat: 40, lng: -120 }])
        expect(picks).toHaveLength(1)
    })
})

// ─── onFeatureHover ───────────────────────────────────────────────────────────

test.describe('LeafletAdapter - onFeatureHover', () => {

    test('registers mousemove and mouseout handlers on the map', () => {
        const { mockMap } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const registeredEvents = []
        mockMap.on = (event) => registeredEvents.push(event)

        adapter.onFeatureHover(() => { })

        expect(registeredEvents).toContain('mousemove')
        expect(registeredEvents).toContain('mouseout')
    })

    test('calls handler with feature: null on mouseout', () => {
        const { mockMap } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        let capturedResult = null
        let mouseoutCallback = null
        mockMap.on = (event, cb) => { if (event === 'mouseout') mouseoutCallback = cb }

        adapter.onFeatureHover((result) => { capturedResult = result })
        mouseoutCallback()

        expect(capturedResult.feature).toBeNull()
    })
})

// ─── queryRenderedFeatures ────────────────────────────────────────────────────

test.describe('LeafletAdapter - queryRenderedFeatures', () => {

    test('returns empty array when no layers are registered', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const results = adapter.queryRenderedFeatures({ x: 0, y: 0 })

        expect(results).toEqual([])
    })

    test('returns empty array when layer has no getBounds', () => {
        setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        const results = adapter.queryRenderedFeatures({ x: 0, y: 0 }, { layers: ['tile-no-bounds'] })

        expect(results).toEqual([])
    })

    test('skips layers not in options.layers filter', () => {
        const { mockGeoJSON } = setupWithLayerMocks()
        const adapter = new LeafletAdapter()
        adapter.init({ containerId: 'map' })

        mockGeoJSON.getBounds = () => ({ contains: () => true })
        global.L.geoJSON = () => mockGeoJSON

        adapter.createLayer({ id: 'included', type: 'vector', geojson: { type: 'FeatureCollection', features: [] } })

        const results = adapter.queryRenderedFeatures({ x: 0, y: 0 }, { layers: ['other-id'] })

        expect(results).toEqual([])
    })
})
