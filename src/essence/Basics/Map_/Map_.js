import $ from 'jquery'
import { isStaticBuild } from '../../../pre/capabilities'
import F_ from '../Formulae_/Formulae_'
import L_ from '../Layers_/Layers_'
import ServiceUrls from '../ServiceUrls/ServiceUrls'
import { captureVector } from '../Layers_/LayerCapturer'
import {
    constructVectorLayer,
    constructSublayers,
} from '../Layers_/LayerConstructors'
import Filtering from '../Layers_/Filtering/Filtering'
import Viewer_ from '../Viewer_/Viewer_'
import Globe_ from '../Globe_/Globe_'
import ToolController_ from '../ToolController_/ToolController_'
import CursorInfo from '../../Ancillary/CursorInfo'
import Description from '../../Ancillary/Description'
import QueryURL from '../../Ancillary/QueryURL'
import MetadataCapturer from '../Layers_/MetadataCapturer.js'
import {
    compileTileUrl,
    buildTileUrlOptions,
    shouldUseDeckRaster,
} from '../Layers_/tileUrlUtils'
import {
    resolveTileLayerSource,
    resolveDeckCOGFileUrl,
    syncTileFormatToConfig,
} from '../Layers_/tileLayerSource'
import { Kinds } from '../../../pre/tools'
import DataShaders from '../../Ancillary/DataShaders'
import calls from '../../../pre/calls'
import TimeControl from '../TimeControl_/TimeControl'

import gjv from 'geojson-validation'
import {
    evaluate_cmap,
    data as colormapData,
} from '../../../external/js-colormaps/js-colormaps.js'

import {
    mapEngineRegistry,
    MAP_ENGINE,
    LeafletAdapter,
    DeckGLAdapter,
} from '../MapEngines/index'
import { buildDeckLayer, buildDeckCOGLayer } from '../MapEngines/Adapters/DeckGLHelpers'

let L = window.L

let essenceFina = function () {}

mapEngineRegistry.register(MAP_ENGINE.LEAFLET, LeafletAdapter)
mapEngineRegistry.register(MAP_ENGINE.DECKGL, DeckGLAdapter)

import GeoRasterLayer from '../../../external/georaster-layer-for-leaflet/georaster-layer-for-leaflet.ts'
import georaster from 'georaster'

// The default color ramp used for image layer types
const IMAGE_DEFAULT_COLOR_RAMP = 'binary'

// Provider cleanup functions for re-initialization
let _providerCleanups = []

let _basemapStyles = []
let _basemapActiveIndex = 0

function _resolveBasemapStyles(basemapConfig, engineType) {
    const isLeaflet = engineType === MAP_ENGINE.LEAFLET

    const MAPBOX_DEFAULTS = [
        { name: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
        { name: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
        { name: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
        { name: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
        { name: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
    ]

    const MAPLIBRE_DEFAULTS_DECKGL = [
        { name: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
        { name: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
        { name: 'Dark', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
    ]
    const MAPLIBRE_DEFAULTS_LEAFLET = [
        { name: 'Streets', style: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
        { name: 'Light', style: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png' },
        { name: 'Dark', style: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' },
        { name: 'Terrain', style: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
    ]

    const maplibreDefaults = isLeaflet ? MAPLIBRE_DEFAULTS_LEAFLET : MAPLIBRE_DEFAULTS_DECKGL

    const styles =
        basemapConfig.styles && basemapConfig.styles.length > 0
            ? [...basemapConfig.styles]
            : basemapConfig.provider === 'mapbox'
                ? [...MAPBOX_DEFAULTS]
                : [...maplibreDefaults]

    return styles
}

let Map_ = {
    /** The native map object (L.Map for Leaflet, Deck for deck.gl). Kept for backward compatibility with existing callers. */
    map: null,
    /** The active IMapEngine adapter. Use this for engine-agnostic operations. */
    engine: null,
    toolbar: null,
    tempOverlayImage: null,
    activeLayer: null,
    allLayersLoadedPassed: false,
    player: { arrow: null, lookat: null },
    /**
     * Return the native layer object expected by the active engine.
     * For deck.gl, extracts `._deckLayer` if present; otherwise returns the layer as-is.
     * For Leaflet, returns the layer unchanged.
     * @param {object} layer - A Leaflet layer, deck.gl Layer, or wrapper object.
     * @returns {object} The native layer for the active engine.
     */
    nativeLayer: function (layer) {
        if (layer && layer._deckLayer != null) return layer._deckLayer
        return layer
    },
    /**
     * Initialize the map using the engine specified in `msv.mapEngine`.
     * Registers both adapters, creates the configured engine, and wires
     * all view/event/layer behaviour through the IMapEngine facade.
     * `Map_.map` is kept pointing to the native map for backward-compatible callers.
     */
    init: function (essenceFinal) {
        essenceFina = essenceFinal

        if (window.L) L.DomEvent._fakeStop = L.DomEvent.fakeStop

        var hasZoomControl = false
        if (L_.configData.look && L_.configData.look.zoomcontrol)
            hasZoomControl = true

        Map_.mapScaleZoom = L_.configData.msv.mapscale || null

        if (this.engine != null) {
            mapEngineRegistry.destroyEngine(this.engine)
            this.engine = null
            this.map = null
        }

        let maxBounds = null
        if (
            !isNaN(L_.configData.msv.maxBoundsTopLeftLat) &&
            !isNaN(L_.configData.msv.maxBoundsTopLeftLng) &&
            !isNaN(L_.configData.msv.maxBoundsBottomRightLat) &&
            !isNaN(L_.configData.msv.maxBoundsBottomRightLng) &&
            !(
                L_.configData.msv.maxBoundsTopLeftLat === 0 &&
                L_.configData.msv.maxBoundsTopLeftLng === 0 &&
                L_.configData.msv.maxBoundsBottomRightLat === 0 &&
                L_.configData.msv.maxBoundsBottomRightLng === 0
            )
        ) {
            maxBounds = [
                [
                    L_.configData.msv.maxBoundsTopLeftLat,
                    L_.configData.msv.maxBoundsTopLeftLng,
                ],
                [
                    L_.configData.msv.maxBoundsBottomRightLat,
                    L_.configData.msv.maxBoundsBottomRightLng,
                ],
            ]
        }

        const engineType = L_.configData.msv.mapEngine || MAP_ENGINE.LEAFLET

        const initOptions = {
            containerId: 'map',
            zoomControl: hasZoomControl,
            editable: true,
            keyboard: false,
            fadeAnimation: true,
            worldCopyJump: L_.configData.msv.worldCopyJump || false,
            maxBounds,
            projection: null,
            basemap: L_.configData.msv.basemap || null,
        }

        if (
            L_.configData.projection &&
            L_.configData.projection.custom === true
        ) {
            const cp = L_.configData.projection
            initOptions.projection = {
                custom: true,
                epsg: cp.epsg,
                proj4: cp.proj,
                origin: cp.origin,
                bounds: cp.bounds,
                resunitsperpixel: cp.resunitsperpixel,
                reszoomlevel: cp.reszoomlevel,
                radius: parseFloat(L_.configData.msv.radius.major),
            }
        } else {
            initOptions.projection = {
                custom: false,
                radius: parseFloat(F_.radiusOfPlanetMajor),
            }
        }

        const engine = mapEngineRegistry.createEngine(engineType)
        mapEngineRegistry.initializeEngine(engine, initOptions)
        this.engine = engine
        mapEngineRegistry.setActiveEngine(engine)
        this.map = engine.getNativeMap() ?? {}

        if (engineType === MAP_ENGINE.DECKGL) {
            this.map.on = (event, handler) => engine.on(event, handler)
            this.map.off = (event, handler) => engine.off(event, handler)
            this.map.addEventListener = (event, handler) => engine.on(event, handler)
            this.map.removeEventListener = (event, handler) => engine.off(event, handler)
            this.map.invalidateSize = () => engine.invalidateSize()
            this.map.getZoom = () => engine.getZoom()
            this.map.getCenter = () => engine.getCenter()
            this.map.getBounds = () => engine.getBounds()
            this.map.setZoom = (zoom) => engine.setZoom(zoom)
            this.map.setView = (latlng, zoom) => engine.setView(latlng, zoom)
            this.map.fitBounds = (bounds, opts) => engine.fitBounds(bounds, opts)
            this.map.panTo = (latlng) => engine.panTo(latlng)
            this.map.addLayer = (layer) => engine.addLayer(layer)
            this.map.removeLayer = (layer) => engine.removeLayer(layer)
            this.map.hasLayer = (layer) => engine.hasLayer(layer)
        }

        if (engineType === MAP_ENGINE.LEAFLET && Map_.mapScaleZoom) {
            L.control
                .scalefactor({
                    radius: parseInt(L_.configData.msv.radius.major),
                    mapScaleZoom: Map_.mapScaleZoom,
                })
                .addTo(this.map)
        }

        if (L_.FUTURES.mapView != null) {
            this.resetView(L_.FUTURES.mapView)
            if (engineType === MAP_ENGINE.LEAFLET && L_.FUTURES.centerPin != null) {
                this._centerPin = new L.circleMarker(
                    [L_.FUTURES.mapView[0], L_.FUTURES.mapView[1]],
                    {
                        fillColor: '#000',
                        fillOpacity: 0,
                        color: 'lime',
                        weight: 2,
                    }
                )
                    .setRadius(4)
                    .addTo(this.map)
                if (
                    L_.FUTURES.centerPin.length > 0 &&
                    L_.FUTURES.centerPin != 'true'
                ) {
                    this._centerPin.on('mouseover', function () {
                        CursorInfo.update(L_.FUTURES.centerPin, null, false)
                    })
                    this._centerPin.on('mouseout', function () {
                        CursorInfo.hide()
                    })
                }
            }
        } else {
            this.resetView(L_.view)
        }

        $('.leaflet-control-attribution').remove()

        // Register map providers for mmgisAPI Event Bus
        if (window.mmgisAPI) {
            // Clean up previous providers if re-initializing
            _providerCleanups.forEach((cleanup) => cleanup())
            _providerCleanups = [
                window.mmgisAPI.provide('map:getCenter', () => engine.getCenter()),
                window.mmgisAPI.provide('map:getBounds', () => engine.getBounds()),
                window.mmgisAPI.provide('map:getZoom', () => engine.getZoom()),
                window.mmgisAPI.provide('map:setView', ({ center, zoom } = {}) => {
                    if (!center) return false
                    engine.setView(center, zoom)
                    return true
                }),
                window.mmgisAPI.provide('map:fitBounds', (payload) => {
                    const bounds = Array.isArray(payload) ? payload : payload?.bounds
                    const options = Array.isArray(payload) ? undefined : payload?.options
                    engine.fitBounds(bounds, options)
                    return true
                }),
                window.mmgisAPI.provide('map:panTo', (latlng) => {
                    engine.panTo(latlng)
                    return true
                }),
                // Drawing — wraps the IMapEngine drawing primitives from spec 013
                window.mmgisAPI.provide('map:enableDrawing', ({ shape, options } = {}) => {
                    engine.enableDrawing(shape, options)
                    return true
                }),
                window.mmgisAPI.provide('map:disableDrawing', () => {
                    engine.disableDrawing()
                    return true
                }),
                window.mmgisAPI.provide('map:finishDrawing', () =>
                    engine.finishDrawing()
                ),
                window.mmgisAPI.provide('map:isDrawing', () => engine.isDrawing()),
                // Layer management — engine-agnostic CRUD on vector layers
                window.mmgisAPI.provide('map:createLayer', (spec) => {
                    engine.createLayer(spec)
                    return true
                }),
                window.mmgisAPI.provide('map:removeLayer', ({ id }) => {
                    engine.removeLayer(id)
                    return true
                }),
                window.mmgisAPI.provide('map:hasLayer', ({ id }) => engine.hasLayer(id)),
                // Anchored HTML overlays — implemented per-engine on IMapEngine
                window.mmgisAPI.provide('map:addOverlay', (options) => {
                    engine.addOverlay(options)
                    return true
                }),
                window.mmgisAPI.provide('map:removeOverlay', ({ id }) => {
                    engine.removeOverlay(id)
                    return true
                }),
                window.mmgisAPI.provide('map:setBasemap', (styleName) => {
                    const index = _basemapStyles.findIndex((s) => s.name === styleName)
                    if (index === -1) {
                        console.warn(`[map:setBasemap] No basemap style found with name: "${styleName}"`)
                        return false
                    }
                    const selectedStyle = _basemapStyles[index]
                    if (!Map_.engine || typeof Map_.engine.setBasemapStyle !== 'function') {
                        console.warn('[map:setBasemap] The active engine does not support basemap switching')
                        return false
                    }
                    if (Map_.engine.setBasemapStyle(selectedStyle.style) === false) {
                        console.warn(`[map:setBasemap] Engine could not apply style: "${styleName}"`)
                        return false
                    }
                    _basemapActiveIndex = index
                    return true
                }),
                window.mmgisAPI.provide('map:getBasemap', () => {
                    if (_basemapStyles.length === 0) return null
                    return { ..._basemapStyles[_basemapActiveIndex] }
                }),
                window.mmgisAPI.provide('map:getBasemapStyles', () => {
                    return [..._basemapStyles]
                }),
                window.mmgisAPI.provide('map:zoomIn', () => {
                    if (!Map_.engine || typeof Map_.engine.getZoom !== 'function') return false
                    const current = Map_.engine.getZoom()
                    const max = typeof Map_.engine.getMaxZoom === 'function'
                        ? Map_.engine.getMaxZoom()
                        : Infinity
                    const next = Math.min(current + 1, max)
                    if (next === current) return false
                    Map_.engine.setZoom(next)
                    return true
                }),
                window.mmgisAPI.provide('map:zoomOut', () => {
                    if (!Map_.engine || typeof Map_.engine.getZoom !== 'function') return false
                    const current = Map_.engine.getZoom()
                    const min = typeof Map_.engine.getMinZoom === 'function'
                        ? Map_.engine.getMinZoom()
                        : -Infinity
                    const next = Math.max(current - 1, min)
                    if (next === current) return false
                    Map_.engine.setZoom(next)
                    return true
                }),
                window.mmgisAPI.provide('map:latLngToContainerPoint', (latlng) => {
                    if (!Map_.engine || typeof Map_.engine.latLngToContainerPoint !== 'function') {
                        return null
                    }
                    if (!latlng || latlng.lat == null || latlng.lng == null) return null
                    const p = Map_.engine.latLngToContainerPoint(latlng)
                    return p ? { x: p.x, y: p.y } : null
                }),
            ]

            // Engine event re-emits — translate adapter events onto the bus
            const reEmit = (engineEvent, busEvent) => {
                const handler = (payload) => window.mmgisAPI.emit(busEvent, payload)
                engine.on(engineEvent, handler)
                _providerCleanups.push(() => engine.off(engineEvent, handler))
            }
            reEmit('drawstart', 'map:drawstart')
            reEmit('drawvertex', 'map:drawvertex')
            reEmit('drawcomplete', 'map:drawcomplete')
            reEmit('drawcancel', 'map:drawcancel')
            reEmit('move', 'map:move')
            reEmit('moveend', 'map:moveend')
            // Pointer streams consumed by plugins (e.g. measure tools, overlays).
            reEmit('click', 'map:click')
            reEmit('mousemove', 'map:mousemove')

            // Feature click → bus. Plugins (e.g. AOI Inspect) consume
            // `map:featureClick` to react to clicks on layers created via
            // `map:createLayer`. The whole pick result is forwarded so
            // consumers can filter by layerId or react to empty-space clicks.
            if (typeof engine.onFeatureClick === 'function') {
                const off = engine.onFeatureClick((info) =>
                    window.mmgisAPI.emit('map:featureClick', info)
                )
                if (typeof off === 'function') _providerCleanups.push(off)
            }
        }

        //Make our layers
        makeLayers(L_.layers.dataFlat)

        allLayersLoaded()

        if (engineType === MAP_ENGINE.LEAFLET && L_.configData.look && L_.configData.look.graticule == true) {
            this.toggleGraticule(true)
        }

        if (engineType === MAP_ENGINE.LEAFLET) {
            this.map.on('zoomend', function () {
                L_.enforceVisibilityCutoffs()
                $('.map-autoset-zoom').text(Map_.map.getZoom())
            })

            this.map.on('movestart', fadeOutCertainLayers)
            this.map.on('zoomstart', fadeOutCertainLayers)

            if (Globe_.controls.link) {
                this.map.on('move', (e) => {
                    const c = this.map.getCenter()
                    Globe_.controls.link.linkMove(c.lng, c.lat)
                })
                this.map.on('mousemove', (e) => {
                    Globe_.controls.link.linkMouseMove(e.latlng.lng, e.latlng.lat)
                })
                this.map.on('mouseout', (e) => {
                    Globe_.controls.link.linkMouseOut()
                })
            }

            Map_.map.addEventListener('click', clearOnMapClick)
        } else {
            this.engine.on('moveend', function () {
                L_.enforceVisibilityCutoffs()
                $('.map-autoset-zoom').text(Map_.engine.getZoom())
            })

            if (Globe_.controls.link) {
                this.engine.on('moveend', () => {
                    const c = Map_.engine.getCenter()
                    Globe_.controls.link.linkMove(c.lng, c.lat)
                })
            }
        }

        function fadeOutCertainLayers() {
            Object.keys(L_.layers.data).forEach((layerUUID) => {
                const layerData = L_.layers.data[layerUUID]
                if (
                    layerData.type === 'velocity' &&
                    (layerData.kind === 'streamlines' || layerData.kind == null)
                ) {
                    L_.layers.layer[layerUUID].setOpacity(0)
                }
            })
        }

        buildToolBar()

        const basemapConfig = L_.configData?.msv?.basemap
        if (basemapConfig && basemapConfig.provider && basemapConfig.provider !== 'none') {
            _basemapStyles = _resolveBasemapStyles(basemapConfig, engineType)
            let activeIndex = _basemapStyles.findIndex(
                (s) => s.style === basemapConfig.style
            )
            // A configured style outside the resolved list must still be
            // reported (and switchable) as the active basemap.
            if (activeIndex === -1 && basemapConfig.style) {
                _basemapStyles.unshift({
                    name: 'Default',
                    style: basemapConfig.style,
                })
                activeIndex = 0
            }
            _basemapActiveIndex = Math.max(activeIndex, 0)
        }

        TimeControl.updateLayersTime()
    },
    /**
     * Toggle the Leaflet graticule overlay. No-op when running under deck.gl
     * since the graticule plugin is Leaflet-specific.
     * @param {boolean} on
     */
    toggleGraticule: function (on) {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return
        if (on)
            this.graticule = L.latlngGraticule({
                showLabel: true,
                color: 'rgba(255,255,255,0.75)',
                weight: 1,
                zoomInterval: [
                    { start: 2, end: 3, interval: 40 },
                    { start: 4, end: 5, interval: 20 },
                    { start: 6, end: 7, interval: 10 },
                    { start: 8, end: 9, interval: 5 },
                    { start: 10, end: 11, interval: 0.4 },
                    { start: 12, end: 13, interval: 0.2 },
                    { start: 14, end: 15, interval: 0.1 },
                    { start: 16, end: 17, interval: 0.01 },
                    { start: 18, end: 19, interval: 0.005 },
                    { start: 20, end: 21, interval: 0.0025 },
                    { start: 21, end: 30, interval: 0.00125 },
                ],
            }).addTo(Map_.map)
        else {
            this.rmNotNull(this.graticule)
            this.graticule = null
        }
    },
    /**
     * Remove all layers from the active engine and reset transient state.
     */
    clear: function () {
        if (this.engine) {
            this.engine.getLayers().forEach((layer) => {
                this.engine.removeLayer(layer)
            })
        } else if (this.map && typeof this.map.eachLayer === 'function') {
            this.map.eachLayer(function (layer) {
                Map_.map.removeLayer(layer)
            })
        }

        this.toolbar = null
        this.tempOverlayImage = null
        this.activeLayer = null
        this.allLayersLoadedPassed = false
        this.player = { arrow: null, lookat: null }
    },
    /** @param {number} zoom */
    setZoomToMapScale() {
        this.engine.setZoom(this.mapScaleZoom)
    },
    /**
     * Fly the 2D map to the given [lat, lon, zoom] triple.
     * @param {Array} latlonzoom - `[lat, lon, zoom]` array from config.
     */
    resetView: function (latlonzoom) {
        var lat = parseFloat(latlonzoom[0])
        if (isNaN(lat)) lat = 0
        var lon = parseFloat(latlonzoom[1])
        if (isNaN(lon)) lon = 0
        // parseFloat: the modern map zooms fractionally; truncating here
        // visibly changes restored views (Leaflet snaps integers itself).
        var zoom = parseFloat(latlonzoom[2])
        if (zoom == null || isNaN(zoom))
            zoom =
                this.engine.getZoom() ||
                L_.configData.msv.mapscale ||
                L_.configData.msv.view[2]
        this.engine.setView({ lat, lng: lon }, zoom)
        this.engine.invalidateSize()
    },
    /**
     * @param {string} layername
     * @returns {boolean} Whether the layer is currently on the map.
     */
    hasLayer: function (layername) {
        if (L_.layers.layer[layername]) {
            return this.engine.hasLayer(
                this.nativeLayer(L_.layers.layer[layername])
            )
        }
        return false
    },
    tempTileLayer: null,
    /**
     * Swap the background tile layer to the given URL.
     * Only supported under Leaflet; no-op for deck.gl.
     * @param {string} url
     */
    changeTempTileLayer: function (url) {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return
        this.removeTempTileLayer()
        this.tempTileLayer = L.tileLayer(url, {
            minZoom: 0,
            maxZoom: 25,
            maxNativeZoom: 25,
            tms: true,
            noWrap: true,
            continuousWorld: true,
            reuseTiles: true,
        }).addTo(this.map)
    },
    //removes that layer
    removeTempTileLayer: function () {
        this.rmNotNull(this.tempTileLayer)
    },
    /**
     * Remove a layer from the active engine if it is non-null.
     * Routes through `IMapEngine.removeLayer` so both Leaflet and deck.gl layers
     * are handled correctly.
     * @param {object} layer
     */
    rmNotNull: function (layer) {
        if (layer != null) {
            CursorInfo.hide(true)
            this.engine.removeLayer(this.nativeLayer(layer))
            layer = null
        }
    },
    /**
     * Re-order all visible layers so they match the configured layer stack order.
     * For deck.gl, z-order is managed via the layer array in the adapter; this
     * method is a no-op for that engine.
     */
    orderedBringToFront: function () {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return
        let hasIndex = []
        let hasIndexRaster = []

        for (let i = L_._layersOrdered.length - 1; i >= 0; i--) {
            if (Map_.hasLayer(L_._layersOrdered[i])) {
                if (L_.layers.data[L_._layersOrdered[i]]) {
                    if (
                        L_.layers.data[L_._layersOrdered[i]].type === 'vector'
                    ) {
                        if (L_.layers.attachments[L_._layersOrdered[i]]) {
                            for (let s in L_.layers.attachments[
                                L_._layersOrdered[i]
                            ]) {
                                Map_.rmNotNull(
                                    L_.layers.attachments[L_._layersOrdered[i]][
                                        s
                                    ].layer
                                )
                            }
                        }
                        Map_.map.removeLayer(
                            L_.layers.layer[L_._layersOrdered[i]]
                        )
                        hasIndex.push(i)
                    } else if (
                        L_.layers.data[L_._layersOrdered[i]].type === 'tile' ||
                        L_.layers.data[L_._layersOrdered[i]].type === 'data'
                    ) {
                        hasIndexRaster.push(i)
                    } else if (
                        L_.layers.data[L_._layersOrdered[i]].type === 'image'
                    ) {
                        Map_.map.removeLayer(
                            L_.layers.layer[L_._layersOrdered[i]]
                        )
                        hasIndex.push(i)
                    }
                }
            }
        }

        // First only vectors and images
        for (let i = 0; i < hasIndex.length; i++) {
            if (L_.layers.attachments[L_._layersOrdered[hasIndex[i]]]) {
                for (let s in L_.layers.attachments[
                    L_._layersOrdered[hasIndex[i]]
                ]) {
                    if (
                        L_.layers.attachments[L_._layersOrdered[hasIndex[i]]][s]
                            .on
                    ) {
                        if (
                            L_.layers.attachments[
                                L_._layersOrdered[hasIndex[i]]
                            ][s].type !== 'model'
                        ) {
                            Map_.map.addLayer(
                                L_.layers.attachments[
                                    L_._layersOrdered[hasIndex[i]]
                                ][s].layer
                            )
                        }
                    }
                }
            }

            Map_.map.addLayer(L_.layers.layer[L_._layersOrdered[hasIndex[i]]])

            // If image layer, reorder the z index and redraw the layer
            if (
                L_.layers.data[L_._layersOrdered[hasIndex[i]]].type === 'image'
            ) {
                L_.layers.layer[L_._layersOrdered[hasIndex[i]]].setZIndex(
                    L_._layersOrdered.length +
                        1 -
                        L_._layersOrdered.indexOf(
                            L_._layersOrdered[hasIndex[i]]
                        )
                )
                L_.layers.layer[L_._layersOrdered[hasIndex[i]]].clearCache()
                L_.layers.layer[L_._layersOrdered[hasIndex[i]]].redraw()
            }
        }

        L_.enforceVisibilityCutoffs()

        // Now only rasters
        // They're separate because its better to only change the raster z-index
        for (let i = 0; i < hasIndexRaster.length; i++) {
            L_.layers.layer[L_._layersOrdered[hasIndexRaster[i]]].setZIndex(
                L_._layersOrdered.length +
                    1 -
                    L_._layersOrdered.indexOf(
                        L_._layersOrdered[hasIndexRaster[i]]
                    )
            )
        }

        // Now bring any Drawn layers back to the front:
        Object.keys(L_.layers.layer).forEach((key) => {
            if (
                key.startsWith('DrawTool_') &&
                Array.isArray(L_.layers.layer[key])
            ) {
                L_.layers.layer[key].forEach((l) => {
                    try {
                        l.bringToFront()
                    } catch (err) {}
                })
            }
        })
    },
    refreshLayer: async function (
        layerObj,
        cb,
        skipOrderedBringToFront,
        stopLoops
    ) {
        // If it's a dynamic extent layer, just re-call its function
        if (
            L_._onSpecificLayerToggleSubscriptions[
                `dynamicextent_${layerObj.name}`
            ] != null
        ) {
            if (L_.layers.on[layerObj.name])
                L_._onSpecificLayerToggleSubscriptions[
                    `dynamicextent_${layerObj.name}`
                ].func(layerObj.name)

            if (typeof cb === 'function') cb()
            return true
        }

        // We need to find and remove all points on the map that belong to the layer
        // Not sure if there is a cleaner way of doing this
        for (var i = L_._layersOrdered.length - 1; i >= 0; i--) {
            if (
                L_.layers.data[L_._layersOrdered[i]] &&
                L_.layers.data[L_._layersOrdered[i]].type == 'vector' &&
                L_.layers.data[L_._layersOrdered[i]].name == layerObj.name
            ) {
                // Original
                if (L_._layersBeingMade[layerObj.name] !== true) {
                    // makeLayer now handles all layer swapping internally for refresh operations
                    L_.layers.on[layerObj.name] = true
                    await makeLayer(
                        layerObj,
                        true,
                        null,
                        null,
                        null,
                        stopLoops,
                        true
                    )
                    L_.addVisible(Map_, [layerObj.name])

                    L_.enforceVisibilityCutoffs()
                } else {
                    console.warn(
                        `WARNING - refreshLayer: Cannot make layer ${layerObj.display_name}/${layerObj.name} as it's already being made!`
                    )
                    if (typeof cb === 'function') cb()
                    return false
                }
                if (typeof cb === 'function') cb()
                return true
            }
        }
    },
    /**
     * Draw the player arrow marker on the map at the given position.
     * Only supported under Leaflet; no-op for deck.gl.
     * @param {number} lng
     * @param {number} lat
     * @param {number} rot - Rotation angle in degrees.
     */
    setPlayerArrow(lng, lat, rot) {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return

        var playerMapArrowOffsets = [
            [0.06, 0],
            [-0.04, 0.04],
            [-0.02, 0],
            [-0.04, -0.04],
        ]
        var playerMapArrowPolygon = []

        if (Map_.map.hasLayer(Map_.player.arrow))
            Map_.map.removeLayer(Map_.player.arrow)
        var scalar = 512 / Math.pow(2, Map_.map.getZoom())
        var rotatedOffsets
        for (var i = 0; i < playerMapArrowOffsets.length; i++) {
            rotatedOffsets = F_.rotatePoint(
                {
                    x: playerMapArrowOffsets[i][0],
                    y: playerMapArrowOffsets[i][1],
                },
                [0, 0],
                -rot
            )
            playerMapArrowPolygon.push([
                lat + scalar * rotatedOffsets.x,
                lng + scalar * rotatedOffsets.y,
            ])
        }
        Map_.player.arrow = L.polygon(playerMapArrowPolygon, {
            color: 'lime',
            opacity: 1,
            lineJoin: 'miter',
            weight: 2,
        }).addTo(Map_.map)
    },
    /**
     * Place the player look-at marker on the map.
     * Only supported under Leaflet; no-op for deck.gl.
     * @param {number} lng
     * @param {number} lat
     */
    setPlayerLookat(lng, lat) {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return

        if (Map_.map.hasLayer(Map_.player.lookat))
            Map_.map.removeLayer(Map_.player.lookat)
        if (lat && lng) {
            Map_.player.lookat = new L.circleMarker([lat, lng], {
                fillColor: 'lime',
                fillOpacity: 0.75,
                color: 'lime',
                opacity: 1,
                weight: 2,
            })
                .setRadius(5)
                .addTo(Map_.map)
        }
    },
    /**
     * Hide the player arrow and/or look-at markers.
     * No-op for deck.gl since those markers are Leaflet-specific.
     * @param {boolean} [hideArrow]
     * @param {boolean} [hideLookat]
     */
    hidePlayer(hideArrow, hideLookat) {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return

        if (hideArrow !== false && Map_.map.hasLayer(Map_.player.arrow))
            Map_.map.removeLayer(Map_.player.arrow)
        if (hideLookat !== false && Map_.map.hasLayer(Map_.player.lookat))
            Map_.map.removeLayer(Map_.player.lookat)
    },
    /**
     * @returns {number} The diagonal of the visible map in metres, or 0 for deck.gl.
     */
    getScreenDiagonalInMeters() {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET) return 0

        let bb = document.getElementById('map').getBoundingClientRect()
        let nwLatLng = Map_.map.containerPointToLatLng([0, 0])
        let seLatLng = Map_.map.containerPointToLatLng([bb.width, bb.height])
        return F_.lngLatDistBetween(
            nwLatLng.lng,
            nwLatLng.lat,
            seLatLng.lng,
            seLatLng.lat
        )
    },
    /**
     * @returns {Array} List of tile XYZ coordinates covering the current viewport, or [] for deck.gl.
     */
    getCurrentTileXYZs() {
        if (this.engine && this.engine.engineType !== MAP_ENGINE.LEAFLET)
            return []

        const bounds = Map_.map.getBounds()
        const zoom = Map_.map.getZoom()

        const min = Map_.map
                .project(bounds.getNorthWest(), zoom)
                .divideBy(256)
                .floor(),
            max = Map_.map
                .project(bounds.getSouthEast(), zoom)
                .divideBy(256)
                .floor(),
            xyzs = [],
            mod = Math.pow(2, zoom)

        for (var i = min.x; i <= max.x; i++) {
            for (var j = min.y; j <= max.y; j++) {
                var x = ((i % mod) + mod) % mod
                var y = ((j % mod) + mod) % mod
                var coords = new L.Point(x, y)
                coords.z = zoom
                xyzs.push(coords)
            }
        }

        return xyzs
    },
    makeLayer: makeLayer,
    makeLayers: makeLayers,
    allLayersLoaded: allLayersLoaded,
}

//Takes an array of layer objects and makes them map layers
function makeLayers(layersObj) {
    //Make each layer (backwards to maintain draw order)
    for (var i = layersObj.length - 1; i >= 0; i--) {
        makeLayer(layersObj[i])
    }
}
//Takes the layer object and makes it a map layer
async function makeLayer(
    layerObj,
    evenIfOff,
    forceGeoJSON,
    id,
    forceMake,
    stopLoops,
    isRefresh = false,
    targetMapContext = null
) {
    // Default to main map context for backward compatibility
    const mapContext = targetMapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
        default: true,
    }
    return new Promise(async (resolve, reject) => {
        const layerName = L_.asLayerUUID(layerObj.name)
        if (forceMake !== true && L_._layersBeingMade[layerName] === true) {
            console.error(
                `ERROR - makeLayer: Cannot make layer ${layerObj.display_name}/${layerObj.name} as it's already being made!`
            )
            resolve(false)
            return
        } else {
            L_._layersBeingMade[layerName] = true
        }
        //Decide what kind of layer it is
        //Headers do not need to be made
        if (layerObj.type != 'header') {
            //Simply call the appropriate function for each layer type
            switch (layerObj.type) {
                case 'vector':
                    await makeVectorLayer(
                        layerObj,
                        evenIfOff,
                        null,
                        forceGeoJSON,
                        isRefresh,
                        mapContext
                    )
                    break
                case 'velocity':
                    await makeVelocityLayer(
                        layerObj,
                        evenIfOff,
                        null,
                        forceGeoJSON,
                        mapContext
                    )
                    break
                case 'tile':
                    makeTileLayer(layerObj, mapContext)
                    break
                case 'vectortile':
                    makeVectorTileLayer(layerObj, mapContext)
                    break
                case 'query':
                    await makeVectorLayer(
                        layerObj,
                        false,
                        true,
                        forceGeoJSON,
                        false,
                        mapContext
                    )
                    break
                case 'data':
                    makeDataLayer(layerObj, mapContext)
                    break
                case 'image':
                    makeImageLayer(layerObj, mapContext)
                    break
                case 'model':
                    //Globe only
                    makeModelLayer(layerObj, mapContext)
                    break
                case 'video':
                    makeVideoLayer(layerObj, mapContext)
                    break
                case 'GeoJsonLayer':
                case 'ScatterplotLayer':
                    await makeVectorLayer(
                        layerObj,
                        evenIfOff,
                        null,
                        forceGeoJSON,
                        isRefresh,
                        mapContext
                    )
                    break
                case 'TileLayer':
                case 'BitmapLayer':
                    makeTileLayer(layerObj, mapContext)
                    break
                case 'MVTLayer':
                    makeVectorTileLayer(layerObj, mapContext)
                    break
                case 'PointCloudLayer':
                case 'Tile3DLayer':
                    makeTileLayer(layerObj, mapContext)
                    break
                default:
                    console.warn('Unknown layer type: ' + layerObj.type)
            }
        }

        // release hold on layer
        L_._layersBeingMade[layerName] = false

        if (stopLoops !== true && layerObj.type === 'vector') {
            Filtering.updateGeoJSON(layerObj.name)
            Filtering.triggerFilter(layerObj.name)
        }
        resolve(true)
    })
}

//Default is onclick show full properties and onhover show 1st property
Map_.onEachFeatureDefault = onEachFeatureDefault
function onEachFeatureDefault(feature, layer) {
    const pv = L_.getLayersChosenNamePropVal(feature, layer)

    layer['useKeyAsName'] = Object.keys(pv)[0]
    if (
        layer.hasOwnProperty('options') &&
        layer.options.hasOwnProperty('layerName')
    ) {
        L_.layers.data[layer.options.layerName].useKeyAsName =
            layer['useKeyAsName']
    }

    if (typeof layer['useKeyAsName'] === 'string') {
        //Add a mouseover event to the layer
        layer.on('mouseover', function () {
            //Make it turn on CursorInfo and show name and value
            CursorInfo.update(pv, null, false)
        })
        //Add a mouseout event
        layer.on('mouseout', function () {
            //Make it turn off CursorInfo
            CursorInfo.hide()
        })
    }

    if (
        !(
            feature.style &&
            feature.style.hasOwnProperty('noclick') &&
            feature.style.noclick
        )
    ) {
        //Add a click event to send the data to the info tab
        layer.on('click', (e) => {
            featureDefaultClick(feature, layer, e)
        })
    }
}

Map_.featureDefaultClick = featureDefaultClick
function featureDefaultClick(feature, layer, e) {
    if (
        ToolController_.activeTool &&
        ToolController_.activeTool.disableLayerInteractions === true
    )
        return
    MetadataCapturer.populateMetadata(layer, () => {
        Kinds.use(
            L_.layers.data[layer.options.layerName].kind,
            Map_,
            feature,
            layer,
            layer.options.layerName,
            null,
            e
        )

        //update url
        if (layer != null && layer.hasOwnProperty('options')) {
            var keyAsName
            if (layer.hasOwnProperty('useKeyAsName')) {
                keyAsName = layer.feature.properties[layer.useKeyAsName]
            } else {
                keyAsName = layer.feature.properties[0]
            }
        }

        Viewer_.changeImages(feature, layer)

        //figure out how to construct searchStr in URL. For example: a ChemCam target can sometime
        //be searched by "target sol", or it can be searched by "sol target" depending on config file.
        var searchToolVars = L_.getToolVars('search')
        var searchfields = {}
        if (searchToolVars.hasOwnProperty('searchfields')) {
            for (var layerfield in searchToolVars.searchfields) {
                var fieldString = searchToolVars.searchfields[layerfield]
                fieldString = fieldString.split(')')
                for (var i = 0; i < fieldString.length; i++) {
                    fieldString[i] = fieldString[i].split('(')
                    var li = fieldString[i][0].lastIndexOf(' ')
                    if (li != -1) {
                        fieldString[i][0] = fieldString[i][0].substring(li + 1)
                    }
                }
                fieldString.pop()
                //0 is function, 1 is parameter
                searchfields[layerfield] = fieldString
            }
        }

        var str = ''
        if (searchfields.hasOwnProperty(layer.options.layerName)) {
            var sf = searchfields[layer.options.layerName] //sf for search field
            for (var i = 0; i < sf.length; i++) {
                str += sf[i][1]
                str += ' '
            }
        }
        str = str.substring(0, str.length - 1)

        var searchFieldTokens = str.split(' ')
        var searchStr

        if (searchFieldTokens.length == 2) {
            if (
                searchFieldTokens[0].toLowerCase() ==
                layer.useKeyAsName.toLowerCase()
            ) {
                searchStr = keyAsName + ' ' + layer.feature.properties.Sol
            } else {
                searchStr = layer.feature.properties.Sol + ' ' + keyAsName
            }
        }

        QueryURL.writeSearchURL([searchStr], layer.options.layerName)

        let _event = new CustomEvent('newActiveFeature', {
            detail: {
                activeFeature: L_.activeFeature,
            },
        })
        document.dispatchEvent(_event)
        // Dual-emit to mmgisAPI Event Bus
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('feature:active', {
                activeFeature: L_.activeFeature,
            })
        }
    })
}

/**
 * Fetches GeoJSON for a vector layer and registers it with the active map engine.
 * @param {object} layerObj - Layer config from the mission JSON.
 * @param {boolean} evenIfOff - Build the layer even if it is toggled off.
 * @param {object|null} useEmptyGeoJSON - Seed with this GeoJSON instead of fetching.
 * @param {object|null} forceGeoJSON - Skip fetch and use this GeoJSON directly.
 * @param {boolean} isRefresh - Suppress side-effects that should only run on first load.
 * @param {object|null} mapContext - Override map/registry context; defaults to main map.
 */
async function makeVectorLayer(
    layerObj,
    evenIfOff,
    useEmptyGeoJSON,
    forceGeoJSON,
    isRefresh = false,
    mapContext = null
) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
        default: true,
    }

    return new Promise((resolve, reject) => {
        if (forceGeoJSON) add(forceGeoJSON)
        else
            captureVector(
                layerObj,
                { evenIfOff: evenIfOff, useEmptyGeoJSON: useEmptyGeoJSON },
                add,
                (f) => {
                    Map_.engine.on('moveend', f)
                    if (
                        layerObj.time?.enabled === true &&
                        layerObj.controlled !== true
                    )
                        L_.subscribeTimeChange(
                            `dynamicextent_${layerObj.name}`,
                            f
                        )
                    L_.subscribeOnSpecificLayerToggle(
                        `dynamicextent_${layerObj.name}`,
                        layerObj.name,
                        f
                    )
                }
            )

        /**
         * Constructs and registers the map layer from fetched GeoJSON data.
         * @param {object|string} data - GeoJSON feature collection, or 'off' to mark layer as disabled.
         * @param {boolean} allowInvalid - Skip GeoJSON validation and render as-is.
         */
        function add(data, allowInvalid) {
            if (
                Map_.engine &&
                Map_.engine.engineType === MAP_ENGINE.DECKGL &&
                layerObj.type === 'ScatterplotLayer'
            ) {
                if (data == null || data === 'off') {
                    L_._layersLoaded[
                        L_._layersOrdered.indexOf(layerObj.name)
                    ] = true
                    ctx.layerRegistry.layer[layerObj.name] =
                        data == null ? null : false
                    allLayersLoaded()
                    resolve()
                    return
                }

                layerObj.style = layerObj.style || {}
                // Layer opacity rides the deck.gl `opacity` prop alone — the
                // one prop setLayerOpacity updates. style.opacity is the
                // configured stroke alpha; deck multiplies the two.
                ctx.layerRegistry.layer[layerObj.name] = buildDeckLayer(
                    layerObj.name,
                    {
                        type: layerObj.type,
                        data,
                        opacity: ctx.layerRegistry.opacity[layerObj.name] ?? 1,
                        style: layerObj.style || {},
                        variables: layerObj.variables || {},
                        interactive: true,
                    }
                )
                L_._layersLoaded[
                    L_._layersOrdered.indexOf(layerObj.name)
                ] = true
                allLayersLoaded()
                resolve()
                return
            }

            data = F_.parseIntoGeoJSON(data)

            let invalidGeoJSONTrace = gjv.valid(data, true)
            const allowableErrors = [`position must only contain numbers`]

            invalidGeoJSONTrace = invalidGeoJSONTrace.filter((t) => {
                if (typeof t !== 'string') return false
                for (let i = 0; i < allowableErrors.length; i++) {
                    if (t.toLowerCase().indexOf(allowableErrors[i]) != -1)
                        return false
                }
                return true
            })
            if (
                data == null ||
                data === 'off' ||
                (invalidGeoJSONTrace.length > 0 && allowInvalid !== true)
            ) {
                if (data != null && data != 'off') {
                    data = null
                    console.warn(
                        `ERROR: ${layerObj.display_name} has invalid GeoJSON!`
                    )
                }

                // For refresh operations, preserve the existing layer on failure
                // to prevent temporary network issues from marking the layer as "layernotfound"
                if (isRefresh && data === null) {
                    const existingLayer = ctx.layerRegistry.layer[layerObj.name]
                    if (existingLayer != null && existingLayer !== false) {
                        console.warn(
                            `[${new Date().toISOString()}] Refresh failed for ${layerObj.display_name}, ` +
                                `keeping existing layer. Next refresh in ${layerObj.time?.refreshIntervalAmount || 60}s`
                        )
                        // Mark layer as having a failed refresh
                        ctx.layerRegistry.refreshFailed[layerObj.name] = true
                        // Dispatch event so LayersTool can update the UI
                        const event = new CustomEvent(
                            'layerRefreshStatusChanged',
                            {
                                detail: {
                                    layerName: layerObj.name,
                                    failed: true,
                                },
                            }
                        )
                        document.dispatchEvent(event)
                        resolve()
                        return
                    }
                }

                // Only set to null for initial loads or if no existing layer
                L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] =
                    true
                ctx.layerRegistry.layer[layerObj.name] =
                    data == null ? null : false
                allLayersLoaded()
                resolve()
                return
            }

            layerObj.style = layerObj.style || {}
            layerObj.style.layerName = layerObj.name

            if (Map_.engine && Map_.engine.engineType === MAP_ENGINE.DECKGL) {
                // Layer opacity rides the deck.gl `opacity` prop alone — the
                // one prop setLayerOpacity updates. style.opacity is the
                // configured stroke alpha; deck multiplies the two.
                ctx.layerRegistry.layer[layerObj.name] = buildDeckLayer(
                    layerObj.name,
                    {
                        type: layerObj.type || 'vector',
                        geojson: data,
                        opacity: ctx.layerRegistry.opacity[layerObj.name] ?? 1,
                        style: layerObj.style || {},
                        variables: layerObj.variables || {},
                        interactive: true,
                    }
                )
                L_._layersLoaded[
                    L_._layersOrdered.indexOf(layerObj.name)
                ] = true
                allLayersLoaded()
                resolve()
                return
            }

            // Leaflet carries layer opacity in the style itself
            layerObj.style.opacity =
                ctx.layerRegistry.opacity[layerObj.name] ?? 1

            const vl = constructVectorLayer(
                data,
                layerObj,
                onEachFeatureDefault,
                Map_ // Keep passing Map_ - constructVectorLayer expects this
            )

            // For refresh operations, toggle off old layer and handle seamless swap
            let wasOnForRefresh = false
            if (
                isRefresh &&
                ctx.layerRegistry.on[layerObj.name] &&
                ctx.layerRegistry.layer[layerObj.name] &&
                ctx.map.hasLayer(ctx.layerRegistry.layer[layerObj.name])
            ) {
                wasOnForRefresh = true
                L_.toggleLayer(
                    ctx.layerRegistry.data[layerObj.name],
                    true,
                    true
                )
            }

            // Only Leaflet vector layers reach here — the deck.gl branch above
            // returns first. Attachments are therefore Leaflet-only, which is
            // why L_.setLayerOpacity skips its sublayer pass for engine-owned
            // layers.
            ctx.layerRegistry.attachments[layerObj.name] = vl.sublayers
            ctx.layerRegistry.layer[layerObj.name] = vl.layer

            // Add to appropriate map
            if (vl.layer && ctx.default != true) {
                vl.layer.addTo(ctx.map)
            }

            // Clear refresh failed status on successful load/refresh
            if (
                ctx.layerRegistry.refreshFailed &&
                ctx.layerRegistry.refreshFailed[layerObj.name]
            ) {
                ctx.layerRegistry.refreshFailed[layerObj.name] = false
                // Dispatch event so LayersTool can update the UI
                const event = new CustomEvent('layerRefreshStatusChanged', {
                    detail: { layerName: layerObj.name, failed: false },
                })
                document.dispatchEvent(event)
            }

            // For refresh operations, turn the new layer back on if the old one was on
            if (isRefresh && wasOnForRefresh) {
                L_.toggleLayer(
                    ctx.layerRegistry.data[layerObj.name],
                    false,
                    true
                )
            }

            L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true

            allLayersLoaded()
            resolve()
        }
    })
}

//For vector velocity layers
async function makeVelocityLayer(
    layerObj,
    evenIfOff,
    useEmptyGeoJSON,
    forceGeoJSON,
    mapContext = null
) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    return new Promise((resolve, reject) => {
        if (forceGeoJSON) add(forceGeoJSON)
        else
            captureVector(
                layerObj,
                { evenIfOff: evenIfOff, useEmptyGeoJSON: useEmptyGeoJSON },
                add,
                (f) => {
                    Map_.engine.on('moveend', f)
                    if (
                        layerObj.time?.enabled === true &&
                        layerObj.controlled !== true
                    )
                        L_.subscribeTimeChange(
                            `dynamicgeodataset_${layerObj.name}`,
                            f
                        )
                    L_.subscribeOnSpecificLayerToggle(
                        `dynamicgeodataset_${layerObj.name}`,
                        layerObj.name,
                        f
                    )
                }
            )

        /**
         * Constructs and registers the map layer from fetched GeoJSON data.
         * @param {object|string} data - GeoJSON feature collection, or 'off' to mark layer as disabled.
         * @param {boolean} allowInvalid - Skip GeoJSON validation and render as-is.
         */
        function add(data, allowInvalid) {
            if (layerObj.type == 'velocity') {
                if (
                    layerObj.kind == 'streamlines' ||
                    'kind' in layerObj == false
                ) {
                    const defaultColors = [
                        'rgb(36,104, 180)',
                        'rgb(60,157, 194)',
                        'rgb(128,205,193 )',
                        'rgb(151,218,168 )',
                        'rgb(198,231,181)',
                        'rgb(238,247,217)',
                        'rgb(255,238,159)',
                        'rgb(252,217,125)',
                        'rgb(255,182,100)',
                        'rgb(252,150,75)',
                        'rgb(250,112,52)',
                        'rgb(245,64,32)',
                        'rgb(237,45,28)',
                        'rgb(220,24,32)',
                        'rgb(180,0,35)',
                    ]
                    let colorScale = ''
                    if (layerObj.variables?.streamlines?.colorScale) {
                        let colorConfig =
                            layerObj.variables?.streamlines?.colorScale
                        if (colorConfig.includes(',')) {
                            colorScale = colorConfig
                                .split('", "')
                                .map((item) => item.replace(/["]/g, ''))
                        } else if (colorConfig === 'DEFAULT') {
                            colorScale = defaultColors
                        } else {
                            // Assume we have a colormap name and look up the values
                            let reverse = false
                            if (colorConfig.endsWith('_r')) {
                                reverse = true
                                colorConfig = colorConfig.slice(0, -2)
                            }
                            colorScale = []
                            let colors = colormapData[colorConfig]?.colors
                            if (colors != null) {
                                colors
                                    .map((color) => {
                                        const r = Math.round(color[0] * 255)
                                        const g = Math.round(color[1] * 255)
                                        const b = Math.round(color[2] * 255)
                                        return `rgb(${r}, ${g}, ${b})`
                                    })
                                    .forEach((colorString) =>
                                        colorScale.push(colorString)
                                    )
                                if (reverse) {
                                    colorScale = colorScale.reverse()
                                }
                            } else {
                                colorScale = defaultColors
                            }
                        }
                    }
                    let velocityLayer = L.velocityLayer({
                        displayValues:
                            layerObj.variables?.streamlines?.displayValues,
                        displayOptions: {
                            position: layerObj.variables?.streamlines
                                ?.displayPosition
                                ? layerObj.variables?.streamlines
                                      ?.displayPosition
                                : 'bottomleft',
                            emptyString: '',
                        },
                        data: data,
                        minVelocity: layerObj.variables?.streamlines
                            ?.minVelocity
                            ? layerObj.variables.streamlines.minVelocity
                            : 0,
                        maxVelocity: layerObj.variables?.streamlines
                            ?.maxVelocity
                            ? layerObj.variables.streamlines.maxVelocity
                            : 15,
                        velocityScale: layerObj.variables?.streamlines
                            ?.velocityScale
                            ? layerObj.variables.streamlines.velocityScale
                            : 0.005,
                        particleAge: layerObj.variables?.streamlines
                            ?.particleAge
                            ? layerObj.variables.streamlines.particleAge
                            : 90,
                        lineWidth: layerObj.variables?.streamlines?.lineWidth
                            ? layerObj.variables.streamlines.lineWidth
                            : 1,
                        particleMultiplier: layerObj.variables?.streamlines
                            ?.particleMultiplier
                            ? layerObj.variables.streamlines.particleMultiplier
                            : 1 / 300,
                        frameRate: layerObj.variables?.streamlines?.frameRate
                            ? layerObj.variables.streamlines.frameRate
                            : 15,
                        colorScale: colorScale,
                    })
                    velocityLayer.setZIndex = function () {}
                    L_.layers.layer[layerObj.name] = velocityLayer
                } else if (layerObj.kind == 'particles') {
                    let points = []
                    if (data.features) {
                        data.features.forEach(function (feature) {
                            points.push([
                                feature.geometry.coordinates[1],
                                feature.geometry.coordinates[0],
                            ])
                        })
                    }
                    let options = {
                        angle: layerObj.variables?.particles?.angle
                            ? layerObj.variables?.particles?.angle
                            : 80,
                        width: layerObj.variables?.particles?.width
                            ? layerObj.variables?.particles?.width
                            : 1,
                        spacing: layerObj.variables?.particles?.spacing
                            ? layerObj.variables?.particles?.spacing
                            : 10,
                        length: layerObj.variables?.particles?.length
                            ? layerObj.variables?.particles?.length
                            : 4,
                        interval: layerObj.variables?.particles?.interval
                            ? layerObj.variables?.particles?.interval
                            : 10,
                        speed: layerObj.variables?.particles?.speed
                            ? layerObj.variables?.particles?.speed
                            : 0.1,
                        color: layerObj.style?.color
                            ? layerObj.style?.color
                            : 'Oxa6b3e9',
                    }
                    let rainLayer = L.rain(points, options)
                    rainLayer.setZIndex = function () {}
                    L_.layers.layer[layerObj.name] = rainLayer
                }
                L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] =
                    true
            }
            allLayersLoaded()
            resolve()
        }
    })
}

/**
 * Builds a raster tile layer (TMS, WMTS, COG via TiTiler, STAC) and registers it with the active map engine.
 * @param {object} layerObj - Layer config from the mission JSON.
 * @param {object|null} mapContext - Override map/registry context; defaults to main map.
 */
async function makeTileLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
        default: true,
    }

    // Shared with TimeControl.reloadLayer so creation and time-driven reloads
    // resolve the same source and tile format.
    const tileSource = resolveTileLayerSource(layerObj)
    const { splitColonType, tileElevation, tileFormat } = tileSource
    let layerUrl = tileSource.url

    syncTileFormatToConfig(layerObj, tileSource)

    let bb = null
    if (layerObj.hasOwnProperty('boundingBox')) {
        bb = L.latLngBounds(
            L.latLng(layerObj.boundingBox[3], layerObj.boundingBox[2]),
            L.latLng(layerObj.boundingBox[1], layerObj.boundingBox[0])
        )
    }
    layerUrl = await TimeControl.performTimeUrlReplacements(
        layerUrl,
        layerObj,
        null
    )

    if (Map_.engine && Map_.engine.engineType === MAP_ENGINE.DECKGL) {
        // Client-side COG rendering via ColormappedCOGLayer (bypasses TiTiler).
        // resolveDeckCOGFileUrl yields the bare, time-substituted .tif URL —
        // the same derivation every rebuild path uses.
        if (shouldUseDeckRaster(Map_.engine.engineType, splitColonType, layerObj)) {
            ctx.layerRegistry.layer[layerObj.name] = buildDeckCOGLayer(layerObj.name, {
                rawCogUrl: resolveDeckCOGFileUrl(layerObj, tileSource),
                layerObj,
                // ?? not ||: an opacity of 0 is a real value, not "default to 1"
                opacity: ctx.layerRegistry.opacity[layerObj.name] ?? 1,
            })
            L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
            allLayersLoaded()
            return
        }

        // DeckGL needs a static URL upfront, so we bake in whatever params Leaflet
        // would normally add per-tile in getTileUrl.
        layerUrl = compileTileUrl(
            layerUrl,
            buildTileUrlOptions(layerObj, splitColonType, tileFormat)
        )

        ctx.layerRegistry.layer[layerObj.name] = buildDeckLayer(layerObj.name, {
            type: layerObj.type || 'tile',
            url: layerUrl,
            tileformat: tileFormat,
            opacity: ctx.layerRegistry.opacity[layerObj.name] ?? 1,
            minZoom: parseInt(layerObj.minZoom),
            maxNativeZoom: parseInt(layerObj.maxNativeZoom),
            maxZoom: parseInt(layerObj.maxZoom),
            tileElevation,
            nativeOptions:
                tileFormat === 'wms'
                    ? {
                          onImageLoad: () =>
                              L_.setLayerLoadStatus(layerObj.name, 'ok'),
                          onImageLoadError: (requestId, error) =>
                              L_.setLayerLoadStatus(
                                  layerObj.name,
                                  'error',
                                  `WMS request failed: ${
                                      error?.message || error
                                  }`
                              ),
                      }
                    : {
                          onTileLoad: () =>
                              L_.setLayerLoadStatus(layerObj.name, 'ok'),
                          onTileError: (error) =>
                              L_.setLayerLoadStatus(
                                  layerObj.name,
                                  'error',
                                  `Tile request failed: ${
                                      error?.message || error
                                  }`
                              ),
                      },
        })
        L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
        allLayersLoaded()
        return
    }

    // Same builder the DeckGL path uses, so both engines see identical,
    // already-formatted time values from the moment the layer is created.
    const tileOptions = buildTileUrlOptions(layerObj, splitColonType, tileFormat)

    ctx.layerRegistry.layer[layerObj.name] = L.tileLayer.colorFilter(layerUrl, {
        // Tile-URL options, spread from the same builder TimeControl passes to
        // refresh() so a layer's creation and refresh options cannot diverge.
        // The Leaflet-only options follow, so they win on any name overlap.
        ...tileOptions,
        minZoom: parseInt(layerObj.minZoom),
        maxZoom: parseInt(layerObj.maxZoom),
        maxNativeZoom: parseInt(layerObj.maxNativeZoom),
        tms: tileFormat === 'tms',
        //noWrap: true,
        continuousWorld: true,
        reuseTiles: true,
        bounds: bb,
        variables: layerObj.variables || {},
    })

    // Add to map
    if (ctx.default != true) {
        ctx.layerRegistry.layer[layerObj.name].addTo(ctx.map)
    }

    L_.setLayerOpacity(
        layerObj.name,
        ctx.layerRegistry.opacity[layerObj.name] ?? 1
    )

    L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
    ctx.layerRegistry.layer[layerObj.name].off('loading')
    ctx.layerRegistry.layer[layerObj.name].on('loading', () => {
        L_.setGlobalLoading(layerObj.name)
    })
    ctx.layerRegistry.layer[layerObj.name].off('tileload')
    ctx.layerRegistry.layer[layerObj.name].on('tileload', () => {
        L_.setLayerLoadStatus(layerObj.name, 'ok')
    })
    ctx.layerRegistry.layer[layerObj.name].off('tileerror')
    ctx.layerRegistry.layer[layerObj.name].on('tileerror', (e) => {
        L_.setLayerLoadStatus(
            layerObj.name,
            'error',
            `Tile request failed: ${e?.tile?.src || layerUrl}`
        )
    })
    ctx.layerRegistry.layer[layerObj.name].off('load')
    ctx.layerRegistry.layer[layerObj.name].on('load', () => {
        // Set default css filters for tile layer
        if (
            layerObj.style?.brightness != null &&
            L_.layers.filters[layerObj.name]?.brightness == null
        )
            L_.setLayerFilter(
                layerObj.name,
                'brightness',
                layerObj.style.brightness
            )
        if (
            layerObj.style?.contrast != null &&
            L_.layers.filters[layerObj.name]?.contrast == null
        )
            L_.setLayerFilter(
                layerObj.name,
                'contrast',
                layerObj.style.contrast
            )
        if (
            layerObj.style?.saturation != null &&
            L_.layers.filters[layerObj.name]?.saturation == null
        )
            L_.setLayerFilter(
                layerObj.name,
                'saturation',
                layerObj.style.saturation
            )
        if (
            layerObj.style?.blend != null &&
            L_.layers.filters[layerObj.name]?.blend == null
        )
            L_.setLayerFilter(
                layerObj.name,
                'mix-blend-mode',
                layerObj.style.blend
            )

        L_.setGlobalLoaded(layerObj.name)
    })
    allLayersLoaded()
}

function makeVectorTileLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    let layerUrl = L_.getUrl(layerObj.type, layerObj.url, layerObj)

    let urlSplit = layerObj.url.split(':')

    if (urlSplit[0].toLowerCase() === 'geodatasets' && urlSplit[1] != null) {
        layerUrl =
            `${window.mmgisglobal.ROOT_PATH || ''}/api/geodatasets/get?layer=${
                urlSplit[1]
            }` + '&type=mvt&x={x}&y={y}&z={z}'
    }

    if (Map_.engine && Map_.engine.engineType === MAP_ENGINE.DECKGL) {
        ctx.layerRegistry.layer[layerObj.name] = buildDeckLayer(layerObj.name, {
            type: layerObj.type || 'vectortile',
            url: layerUrl,
            opacity: ctx.layerRegistry.opacity[layerObj.name] ?? 1,
            minZoom: parseInt(layerObj.minZoom),
            maxNativeZoom: parseInt(layerObj.maxNativeZoom),
            maxZoom: parseInt(layerObj.maxZoom),
            style: layerObj.style || {},
            interactive: true,
            nativeOptions: {
                autoHighlight: layerObj.style?.hoverHighlight === true,
                onHover: (info) => {
                    const properties = info?.object?.properties
                    const vtKey = layerObj.style?.vtKey

                    if (properties == null || vtKey == null || properties[vtKey] == null) {
                        CursorInfo.hide(true)
                        return
                    }

                    CursorInfo.update(
                        vtKey + ': ' + properties[vtKey],
                        null,
                        false
                    )
                },
            },
        })
        L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
        allLayersLoaded()
        return
    }

    var bb = null
    if (layerObj.hasOwnProperty('boundingBox')) {
        bb = L.latLngBounds(
            L.latLng(layerObj.boundingBox[3], layerObj.boundingBox[2]),
            L.latLng(layerObj.boundingBox[1], layerObj.boundingBox[0])
        )
    }

    var clearHighlight = function () {
        for (let l of Object.keys(L_.layers.data)) {
            if (L_.layers.layer[l]) {
                var highlight = L_.layers.layer[l].highlight
                if (highlight) {
                    L_.layers.layer[l].resetFeatureStyle(highlight)
                }
                L_.layers.layer[l].highlight = null
            }
        }
    }
    var timedSelectTimeout = null
    var timedSelect = function (layer, layerName, e) {
        clearTimeout(timedSelectTimeout)
        timedSelectTimeout = setTimeout(
            (function (layer, layerName, e) {
                return function () {
                    let ell = { latlng: null }
                    if (e.latlng != null)
                        ell.latlng = JSON.parse(JSON.stringify(e.latlng))
                    MetadataCapturer.populateMetadata(layer, () => {
                        Kinds.use(
                            L_.layers.data[layerName].kind,
                            Map_,
                            L_.layers.layer[layerName].activeFeatures[0],
                            layer,
                            layerName,
                            null,
                            ell
                        )

                        ToolController_.getTool('InfoTool').use(
                            layer,
                            layerName,
                            L_.layers.layer[layerName].activeFeatures,
                            null,
                            null,
                            null,
                            ell
                        )
                        L_.layers.layer[layerName].activeFeatures = []
                    })
                }
            })(layer, layerName, e),
            100
        )
    }

    var vectorTileOptions = {
        layerName: layerObj.name,
        rendererFactory: L.svg.tile,
        vectorTileLayerStyles: layerObj.style.vtLayer || {},
        interactive: true,
        minZoom: layerObj.minZoom,
        maxZoom: layerObj.maxZoom,
        maxNativeZoom: layerObj.maxNativeZoom,
        getFeatureId: (function (vtId) {
            return function (f) {
                if (
                    f.properties.properties &&
                    typeof f.properties.properties === 'string'
                ) {
                    f.properties = JSON.parse(f.properties.properties)
                }
                return f.properties[vtId]
            }
        })(layerObj.style.vtId),
    }

    L_.layers.layer[layerObj.name] = L.vectorGrid
        .protobuf(layerUrl, vectorTileOptions)
        .on('click', function (e, b, x) {
            let layerName = e.target.options.layerName
            let vtId = L_.layers.layer[layerName].vtId
            clearHighlight()
            L_.layers.layer[layerName].highlight = e.layer.properties[vtId]

            L_.layers.layer[layerName].setFeatureStyle(
                L_.layers.layer[layerName].highlight,
                {
                    weight: 2,
                    color: 'red',
                    opacity: 1,
                    fillColor: 'red',
                    fill: true,
                    radius: 4,
                    fillOpacity: 1,
                }
            )
            L_.layers.layer[layerName].activeFeatures =
                L_.layers.layer[layerName].activeFeatures || []
            L_.layers.layer[layerName].activeFeatures.push({
                type: 'Feature',
                properties: e.layer.properties,
                geometry: {},
            })

            Map_.activeLayer = e.layer
            if (Map_.activeLayer) L_.Map_._justSetActiveLayer = true

            let p = e.sourceTarget._point

            if (p) {
                for (var i in e.layer._renderer._features) {
                    if (
                        e.layer._renderer._features[i].feature._pxBounds.min
                            .x <= p.x &&
                        e.layer._renderer._features[i].feature._pxBounds.max
                            .x >= p.x &&
                        e.layer._renderer._features[i].feature._pxBounds.min
                            .y <= p.y &&
                        e.layer._renderer._features[i].feature._pxBounds.max
                            .y >= p.y &&
                        e.layer._renderer._features[i].feature.properties[
                            vtId
                        ] != e.layer.properties[vtId]
                    ) {
                        L_.layers.layer[layerName].activeFeatures.push({
                            type: 'Feature',
                            properties:
                                e.layer._renderer._features[i].feature
                                    .properties,
                            geometry: {},
                        })
                    }
                }
            }

            timedSelect(e.layer, layerName, e)

            L.DomEvent.stop(e)
        })
        .on(
            'mouseover',
            (function (vtKey) {
                return function (e, a, b, c) {
                    if (vtKey != null)
                        CursorInfo.update(
                            vtKey + ': ' + e.layer.properties[vtKey],
                            null,
                            false
                        )
                }
            })(layerObj.style.vtKey)
        )
        .on('mouseout', function () {
            CursorInfo.hide()
        })

    L_.layers.layer[layerObj.name].vtId = layerObj.style.vtId
    L_.layers.layer[layerObj.name].vtKey = layerObj.style.vtKey

    L_.setLayerOpacity(layerObj.name, L_.layers.opacity[layerObj.name])

    L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
    allLayersLoaded()
}

function makeModelLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
    allLayersLoaded()
}

function makeDataLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    let layerUrl = L_.getUrl(layerObj.type, layerObj.demtileurl, layerObj)

    let bb = null
    if (layerObj.hasOwnProperty('boundingBox')) {
        bb = L.latLngBounds(
            L.latLng(layerObj.boundingBox[3], layerObj.boundingBox[2]),
            L.latLng(layerObj.boundingBox[1], layerObj.boundingBox[0])
        )
    }

    const shader = F_.getIn(layerObj, 'variables.shader') || {}
    const shaderType = shader.type || 'image'

    var uniforms = {}
    for (let i = 0; i < DataShaders[shaderType].settings.length; i++) {
        uniforms[DataShaders[shaderType].settings[i].parameter] =
            DataShaders[shaderType].settings[i].value
    }

    L_.layers.layer[layerObj.name] = L.tileLayer.gl({
        options: {
            tms: true,
            bounds: bb,
        },
        fragmentShader: DataShaders[shaderType].frag,
        tileUrls: [layerUrl],
        pixelPerfect: true,
        uniforms: uniforms,
    })

    if (DataShaders[shaderType].attachImmediateEvents) {
        DataShaders[shaderType].attachImmediateEvents(layerObj.name, shader)
    }

    L_.setLayerOpacity(layerObj.name, L_.layers.opacity[layerObj.name])

    L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
    allLayersLoaded()
}

function makeImageLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    let layerUrl = L_.getUrl(layerObj.type, layerObj.url, layerObj)
    if (!F_.isUrlAbsolute(layerUrl)) {
        layerUrl = `${ServiceUrls.getLocalBaseUrl()}/${layerUrl}`
    }

    let bb = null
    if (layerObj.hasOwnProperty('boundingBox')) {
        bb = L.latLngBounds(
            L.latLng(layerObj.boundingBox[3], layerObj.boundingBox[2]),
            L.latLng(layerObj.boundingBox[1], layerObj.boundingBox[0])
        )
    }

    const cogColormap = F_.getIn(L_.layers.data[layerObj.name], 'cogColormap')

    parseGeoraster(layerUrl)
        .then(async (georaster) => {
            let pixelValuesToColorFn = null
            if (
                F_.getIn(
                    L_.layers.data[layerObj.name],
                    'variables.hideNoDataValue'
                ) === true
            ) {
                pixelValuesToColorFn = (values) => {
                    // https://github.com/GeoTIFF/georaster-layer-for-leaflet/issues/16
                    return values[0] === georaster.noDataValue
                        ? null
                        : `rgb(${values[0]},${values[1]},${values[2]})`
                }
            }

            const imageInfo = F_.getIn(
                L_.layers.data[layerObj.name],
                'variables.image'
            )

            const hideNoDataValue = F_.getIn(
                L_.layers.data[layerObj.name],
                'variables.hideNoDataValue'
            )

            let min = null
            let max = null
            if (georaster.numberOfRasters === 1) {
                min = layerObj.cogMin
                max = layerObj.cogMax

                if (
                    isNaN(parseFloat(layerObj.cogMin)) ||
                    isNaN(parseFloat(layerObj.cogMax))
                ) {
                    if (isStaticBuild()) {
                        // Static builds have no gdal backend; ask the layer's
                        // external TiTiler for the band's statistics instead
                        const titilerBase = ServiceUrls.getTiTilerUrl(layerObj)
                        if (titilerBase != null) {
                            await fetch(
                                `${titilerBase}/cog/statistics?url=${encodeURIComponent(
                                    layerUrl
                                )}&bidx=1`
                            )
                                .then((response) => {
                                    if (!response.ok)
                                        throw new Error(
                                            `TiTiler statistics returned ${response.status}`
                                        )
                                    return response.json()
                                })
                                .then((stats) => {
                                    // TiTiler keys statistics by band ('b1');
                                    // fall back to the first band returned
                                    const band =
                                        stats == null
                                            ? null
                                            : stats.b1 ||
                                              stats[Object.keys(stats)[0]]
                                    if (band != null) {
                                        if (
                                            isNaN(parseFloat(layerObj.cogMin))
                                        ) {
                                            min = band.min
                                            layerObj.cogMin = min
                                        }
                                        if (
                                            isNaN(parseFloat(layerObj.cogMax))
                                        ) {
                                            max = band.max
                                            layerObj.cogMax = max
                                        }
                                    }
                                })
                                .catch((err) => {
                                    console.warn(
                                        `Failed to get TiTiler minmax statistics for ${layerObj.name}`,
                                        err
                                    )
                                })
                        } else {
                            console.warn(
                                `Failed to get minmax statistics for ${layerObj.name}: no TiTiler URL configured`
                            )
                        }
                    } else {
                        // Try to get the min and max values using gdal if the user did not input min/max in the layer config
                        $.ajax({
                            type: calls.getminmax.type,
                            url: calls.getminmax.url,
                            data: {
                                type: 'minmax',
                                path: calls.getprofile.pathprefix + layerUrl,
                                bands: '[1]', // Assume the geotiff images only have a single band
                            },
                            async: false,
                            success: function (data) {
                                if (
                                    data &&
                                    data[0] &&
                                    data[0].band &&
                                    data[0].band === 1
                                ) {
                                    if (isNaN(parseFloat(layerObj.cogMin))) {
                                        min = data[0].min
                                        layerObj.cogMin = min
                                    }
                                    if (isNaN(parseFloat(layerObj.cogMax))) {
                                        max = data[0].max
                                        layerObj.cogMax = max
                                    }
                                }
                            },
                            error: function (request, status, error) {
                                console.warn(
                                    `Failed to get gdal minmax info for ${layerObj.name}`,
                                    request,
                                    status,
                                    error
                                )
                            },
                        })
                    }
                }

                // FIXME A lot of this code is duplicated in LayersTool so find some way to consolidate them as functions
                var range = max - min
                let colormap = null
                let reverse = false
                if (
                    layerObj.cogTransform === true &&
                    'cogColormap' in layerObj
                ) {
                    colormap = layerObj.cogColormap
                    // TiTiler colormap variables are all lower case so we need to format them correctly for js-colormaps
                    if (colormap.toLowerCase().endsWith('_r')) {
                        colormap = colormap.substring(0, colormap.length - 2)
                        reverse = true
                    }

                    let index = Object.keys(colormapData).findIndex((v) => {
                        return v.toLowerCase() === colormap.toLowerCase()
                    })

                    if (index > -1) {
                        colormap = Object.keys(colormapData)[index]
                    } else {
                        colormap = 'binary' // Give it the default value
                    }
                } else {
                    colormap = 'binary' // Give it the default value
                }

                pixelValuesToColorFn = (values) => {
                    var pixelValue = values[0] // single band
                    // don't return a color
                    if (
                        georaster.noDataValue != null &&
                        georaster.noDataValue === pixelValue
                    ) {
                        if (hideNoDataValue) {
                            return null
                        }

                        // Handle the case where we do not want to hide noDataValue
                        return [0, 0, 0]
                    }

                    // scale from 0 - 1
                    var scaledPixelValue = (pixelValue - min) / range
                    if (!(scaledPixelValue >= 0 && scaledPixelValue <= 1)) {
                        if (imageInfo && imageInfo.fillMinMax) {
                            if (scaledPixelValue <= 0) {
                                scaledPixelValue = 0
                            } else if (scaledPixelValue >= 1.0) {
                                scaledPixelValue = 1
                            }
                        } else {
                            return null
                        }
                    }

                    return evaluate_cmap(
                        scaledPixelValue,
                        colormap || IMAGE_DEFAULT_COLOR_RAMP,
                        reverse
                    )
                }
            }

            L_.layers.layer[layerObj.name] = new GeoRasterLayer({
                georaster: georaster,
                resolution: 256,
                opacity: 1.0,
                pixelValuesToColorFn: pixelValuesToColorFn,
            })

            L_.layers.layer[layerObj.name].clearCache()

            L_.layers.layer[layerObj.name].setZIndex(
                L_._layersOrdered.length +
                    1 -
                    L_._layersOrdered.indexOf(layerObj.name)
            )

            L_.setLayerOpacity(layerObj.name, L_.layers.opacity[layerObj.name])

            L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
            allLayersLoaded()
        })
        .catch((e) => {
            console.warn(`WARNING - Unable to load image: ${layerUrl}`)

            L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
            L_.layers.layer[layerObj.name] = null
            allLayersLoaded()
        })
}

function makeVideoLayer(layerObj, mapContext = null) {
    // Default to main map context for backward compatibility
    const ctx = mapContext || {
        map: Map_.map,
        layerRegistry: L_.layers,
    }
    let layerUrl = L_.getUrl(layerObj.type, layerObj.url, layerObj)
    if (!F_.isUrlAbsolute(layerUrl)) {
        layerUrl = `${ServiceUrls.getLocalBaseUrl()}/${layerUrl}`
    }

    if (!layerObj.boundingBox || layerObj.boundingBox.length !== 4) {
        console.warn(
            `Video layer '${layerObj.name}' missing required bounding box`
        )
        L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
        L_.layers.layer[layerObj.name] = null
        allLayersLoaded()
        return
    }

    const bounds = [
        [
            parseFloat(layerObj.boundingBox[1]),
            parseFloat(layerObj.boundingBox[0]),
        ],
        [
            parseFloat(layerObj.boundingBox[3]),
            parseFloat(layerObj.boundingBox[2]),
        ],
    ]

    const videoOptions = {
        opacity: layerObj.initialOpacity != null ? layerObj.initialOpacity : 1,
        autoplay: F_.getIn(layerObj, 'variables.video.autoplay', false),
        loop: F_.getIn(layerObj, 'variables.video.loop', true),
        muted: true, // Always muted by default
        playsInline: true,
    }

    try {
        L_.layers.layer[layerObj.name] = L.videoOverlay(
            layerUrl,
            bounds,
            videoOptions
        )

        // Add updateFilter function to video layer for CSS filter support
        L_.layers.layer[layerObj.name].updateFilter = function (filterArray) {
            const videoElement = this.getElement()
            if (videoElement) {
                let cssFilters = []

                filterArray.forEach((filter) => {
                    const [property, value] = filter.split(':')
                    // Skip blend mode for videos - only handle CSS filters
                    if (property !== 'mix-blend-mode') {
                        if (property === 'saturate') {
                            cssFilters.push(
                                `saturate(${parseFloat(value) * 100}%)`
                            )
                        } else if (property === 'brightness') {
                            cssFilters.push(
                                `brightness(${parseFloat(value) * 100}%)`
                            )
                        } else if (property === 'contrast') {
                            cssFilters.push(
                                `contrast(${parseFloat(value) * 100}%)`
                            )
                        }
                    }
                })

                // Apply CSS filters to video element
                videoElement.style.filter = cssFilters.join(' ')
            }
        }

        L_.layers.layer[layerObj.name].setZIndex(
            L_._layersOrdered.length +
                1 -
                L_._layersOrdered.indexOf(layerObj.name)
        )

        L_.setLayerOpacity(layerObj.name, L_.layers.opacity[layerObj.name])

        L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
        allLayersLoaded()
    } catch (e) {
        console.warn(`WARNING - Unable to load video layer: ${layerUrl}`, e)
        L_._layersLoaded[L_._layersOrdered.indexOf(layerObj.name)] = true
        L_.layers.layer[layerObj.name] = null
        allLayersLoaded()
    }
}

//Because some layers load faster than others, check to see if
// all our layers were loaded before moving on
function allLayersLoaded() {
    if (!Map_.allLayersLoadedPassed) {
        //Only continues if all layers have been loaded
        for (var i = 0; i < L_._layersLoaded.length; i++) {
            if (L_._layersLoaded[i] == false) {
                return
            }
        }
        Map_.allLayersLoadedPassed = true

        //Then do these
        essenceFina()
        L_.addVisible(Map_)
        L_.enforceVisibilityCutoffs()

        ToolController_.finalizeTools()

        L_.loaded()
        //OTHER TEMPORARY TEST STUFF THINGS

        if (L_.UserInterface_.isMobile !== true) {
            // Turn on legend if displayOnStart is true
            if ('LegendTool' in ToolController_.toolModules) {
                if (
                    ToolController_.toolModules['LegendTool'].displayOnStart ==
                    true
                ) {
                    ToolController_.toolModules['LegendTool'].make(
                        'toolContentSeparated_Legend'
                    )
                    ToolController_.activeSeparatedTools.push('LegendTool')
                    let _event = new CustomEvent('toggleSeparatedTool', {
                        detail: {
                            toggledToolName: 'LegendTool',
                            visible: true,
                        },
                    })
                    document.dispatchEvent(_event)
                }
            }
        }
    }
}

function buildToolBar() {
    $('#mapToolBar').html('')

    Map_.toolBar = $('<div>')
        .attr('class', 'row childpointerevents')
        .css('height', '100%')
    $('#mapToolBar').append(Map_.toolBar)

    const scaleBarBounds = $('<div>').attr('id', 'scaleBarBounds').css({
        width: '270px',
        height: '36px',
    })
    Map_.toolBar.append(scaleBarBounds)

    // Create SVG with proper namespace for D3 compatibility
    const scaleBarSvg = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
    )
    scaleBarSvg.setAttribute('id', 'scaleBar')
    scaleBarSvg.setAttribute('width', '270px')
    scaleBarSvg.setAttribute('height', '36px')
    scaleBarBounds.append(scaleBarSvg)
}

function clearOnMapClick(event) {
    if (Map_._justSetActiveLayer) {
        Map_._justSetActiveLayer = false

        L_.setActiveFeature(null)

        let _event = new CustomEvent('newActiveFeature', {
            detail: {
                activeFeature: null,
            },
        })
        document.dispatchEvent(_event)
        // Dual-emit to mmgisAPI Event Bus
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('feature:active', { activeFeature: null })
        }
        return
    }
    // Skip if there is no actively selected feature
    if (!Map_.activeLayer) {
        L_.setActiveFeature(null)

        let _event = new CustomEvent('newActiveFeature', {
            detail: {
                activeFeature: null,
            },
        })
        document.dispatchEvent(_event)
        // Dual-emit to mmgisAPI Event Bus
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('feature:active', { activeFeature: null })
        }
        return
    }

    if ('latlng' in event) {
        // Position of clicked element
        const latlng = event.latlng

        let found = false
        // For all MMGIS layers
        for (let key in L_.layers.layer) {
            if (L_.layers.layer[key] === false || L_.layers.layer[key] == null)
                continue
            let layers

            // Layers can be a LayerGroup or an array of LayerGroup
            if ('getLayers' in L_.layers.layer[key]) {
                layers = L_.layers.layer[key].getLayers()
            }

            if (Array.isArray(L_.layers.layer[key])) {
                layers = L_.layers.layer[key]
            }

            for (let k in layers) {
                const layer = layers[k]
                if (!layer) continue
                if ('getLayers' in layer) {
                    const _layer = layer.getLayers()
                    for (let x in _layer) {
                        found = checkBounds(_layer[x])
                        // We should bubble down further for layers that have no fill, as it is possible
                        // for there to be layers with features under the transparent fill
                        if (found) {
                            if (layer.options.fill) {
                                break
                            } else {
                                found = false
                            }
                        }
                    }
                } else {
                    found = checkBounds(layer)
                    if (found) {
                        // We should bubble down further for layers that have no fill, as it is possible
                        // for there to be layers with features under the transparent fill
                        if (layer.options.fill) {
                            break
                        } else {
                            found = false
                        }
                    }
                }

                if (found) break
            }

            if (found) {
                // If a clicked feature is found, break out early because MMGIS can only select
                // a single feature at a time (i.e. no group select)
                break
            }

            function checkBounds(layer) {
                if (
                    layer.feature &&
                    layer.feature.geometry.type.toLowerCase() === 'polygon'
                ) {
                    if (
                        L.leafletPip.pointInLayer(
                            [latlng.lng, latlng.lat],
                            layer
                        ).length > 0
                    )
                        return true
                } else if ('getBounds' in layer) {
                    // Use the pixel bounds because longitude/latitude conversions for bounds
                    // may be odd in the case of polar projections
                    if (
                        layer._pxBounds &&
                        layer._pxBounds.contains(event.layerPoint)
                    ) {
                        return true
                    }
                } else if ('getLatLng' in layer) {
                    // A latlng is a latlng, regardless of the projection type
                    // WARNING: This is imperfect because the click latlng and marker center latlng
                    // can differ but still intersect
                    if (layer.getLatLng().equals(latlng)) {
                        return true
                    }
                }
                return false
            }
        }

        // If no feature was selected by this click event, clear the currently selected item
        if (!found) {
            L_.setActiveFeature(null)
        }
    }
}

export default Map_
