import { test, expect } from 'vitest'
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

    test('exposes captureScreenshot() as part of the IMapEngine contract', () => {
        // The engine-aware screenshot path (issue #143) requires every adapter
        // to implement captureScreenshot(). LeafletAdapter delegates to the
        // shared html2canvas helper; here we assert the method is present so
        // mmgisAPI.getMapScreenshot() can call it uniformly.
        const adapter = new LeafletAdapter()
        expect(typeof adapter.captureScreenshot).toBe('function')
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

// ─── removeLayer ─────────────────────────────────────────────────────────────

test.describe('LeafletAdapter - removeLayer', () => {

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
