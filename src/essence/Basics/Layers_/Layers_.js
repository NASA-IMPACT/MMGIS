// Holds all layer data
import F_ from '../Formulae_/Formulae_'
import Description from '../../Ancillary/Description'
import Search from '../../Ancillary/Search'
import Attributions from '../../Ancillary/Attributions'
import ToolController_ from '../../Basics/ToolController_/ToolController_'
import LayerGeologic from './LayerGeologic/LayerGeologic'
import ServiceUrls from '../ServiceUrls/ServiceUrls'
import { isRasterTileLayerType } from '../MapEngines/types/engine'
import $ from 'jquery'

// Provider cleanup functions for re-initialization
let _providerCleanups = []

const L_ = {
    url: window.location.href,
    mission: null,
    missionPath: null,
    missionsList: [],
    recentMissions: [],
    site: null,
    view: null,
    radius: null,
    masterdb: false,
    Viewer_: null,
    Map_: null,
    Globe_: null,
    UserInterface_: null,
    TimeControl_: null,
    tools: null,
    _toolCopyables: {},
    //The full, unchanged data
    configData: null,
    layers: {
        data: {}, // layersNamed but by uuid
        dataFlat: [], //layersData
        layer: {}, // layersGroup
        attachments: {}, // layersGroupSubLayers
        on: {}, // toggledArray
        opacity: {}, // opacityArray
        filters: {}, // layerFilters
        nameToUUID: {},
        refreshIntervals: {}, // In order to reloadLayer
        refreshFailed: {}, // Track layers with failed refreshes
    },
    // ===== Private ======
    //Index -> layer name
    _layersOrdered: [], // 78 uses
    //Index -> had loaded (T/F) (same index as orderedLayers)
    _layersLoaded: [], // 27 uses
    //Name -> parent
    _layersParent: {}, // 5 uses
    //
    _localTimeFilterCache: {},
    //FUTURES
    FUTURES: {
        site: null,
        viewerImg: null,
        mapView: null,
        globeView: null,
        globeCamera: null,
        panelPercents: null,
    },
    //URL search strings
    searchStrings: null,
    GEOJSON_PRECISION: 10,
    //URL search file
    searchFile: null,
    toolsLoaded: false,
    addedfiles: {}, //filename -> null (not null if added)
    activeFeature: null,
    lastActiveFeature: {
        layerName: null,
        type: null, // point, line, polygon
        lat: null,
        lon: null,
        key: null, // if not a point, a property field to a unique value
        value: null,
    },
    // features manually turned off
    toggledOffFeatures: [],
    mapAndGlobeLinked: false,
    addLayerQueue: [],
    _layersBeingMade: {},
    _onLoadCallbacks: [],
    _loaded: false,
    init: async function (configData, missionsList, urlOnLayers) {
        await parseConfig(configData, urlOnLayers)
        L_.missionsList = missionsList
    },
    onceLoaded(cb) {
        if (L_._loaded === true) cb()
        else L_._onLoadCallbacks.push(cb)
    },
    loaded: function () {
        L_._loaded = true
        L_._onLoadCallbacks.forEach((cb) => {
            cb()
        })
        L_._onLoadCallbacks = []
    },
    clear: function () {
        L_.mission = null
        L_.missionPath = null
        L_.missionsList = []
        L_.site = null
        L_.view = null
        L_.radius = null
        L_.masterdb = false
        L_.Viewer_ = null
        L_.Map_ = null
        L_.Globe_ = null
        L_.UserInterface_ = null
        L_.tools = null
        L_.configData = null
        L_.layers = {
            data: {},
            dataFlat: [],
            leafletLayer: {},
            attachments: {},
            toggled: {},
            opacity: {},
            filters: {},
        }
        L_._layersOrdered = []
        L_._layersLoaded = []
        L_._layersParent = {}
        L_._localTimeFilterCache = {}
        L_.FUTURES = {
            site: null,
            mapView: null,
            globeView: null,
            globeCamera: null,
            panelPercents: null,
            activePoint: null,
            centerPin: null,
        }
        L_.searchStrings = null
        L_.searchFile = null
        L_.toolsLoaded = false
        L_.activeFeature = null
        L_.lastActiveFeature = {
            layerName: null,
            lat: null,
            lon: null,
            key: null,
            value: null,
        }
    },
    fina: function (
        viewer_,
        map_,
        globe_,
        userinterface_,
        coordinates,
        timecontrol_
    ) {
        this.Viewer_ = viewer_
        this.Map_ = map_
        this.Globe_ = globe_
        this.UserInterface_ = userinterface_
        this.Coordinates = coordinates
        this.TimeControl_ = timecontrol_

        // Register layers providers for mmgisAPI Event Bus
        if (window.mmgisAPI) {
            // Clean up previous providers if re-initializing
            _providerCleanups.forEach((cleanup) => cleanup())
            _providerCleanups = [
                window.mmgisAPI.provide('layers:getAll', () => Object.keys(L_.layers.data)),
                window.mmgisAPI.provide('layers:getVisible', () => L_.layers.on),
                window.mmgisAPI.provide('layers:getConfig', (layerUUID) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    return L_.layers.data[uuid] || null
                }),
                window.mmgisAPI.provide('layers:toggle', async (layerUUID) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    if (L_.layers.data[uuid]) {
                        await L_.toggleLayer(L_.layers.data[uuid])
                        return L_.layers.on[uuid]
                    }
                    return null
                }),
                window.mmgisAPI.provide('layers:getOpacity', (layerUUID) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    return L_.layers.opacity[uuid] ?? 1
                }),
                window.mmgisAPI.provide('layers:setOpacity', ({ layerUUID, opacity }) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    if (L_.layers.data[uuid]) {
                        L_.layers.opacity[uuid] = opacity
                        L_.setLayerOpacity(uuid, opacity)
                        return true
                    }
                    return false
                }),
                window.mmgisAPI.provide('layers:refresh', ({ layerUUID, options }) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    const tileLayer = L_.layers.layer[uuid]
                    if (tileLayer && typeof tileLayer.refresh === 'function') {
                        tileLayer.refresh(null, false, options || {})
                        return true
                    }
                    return false
                }),
                window.mmgisAPI.provide('layers:updateConfig', ({ layerUUID, updates }) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    const layerConfig = L_.layers.data[uuid]
                    if (layerConfig) {
                        Object.assign(layerConfig, updates)
                        return true
                    }
                    return false
                }),
                window.mmgisAPI.provide('layers:getAllConfigs', () => L_.layers.data),
                window.mmgisAPI.provide('layers:getAllOpacities', () => L_.layers.opacity),
                window.mmgisAPI.provide('layers:isVisible', (layerUUID) => {
                    const uuid = L_.asLayerUUID(layerUUID)
                    return L_.layers.on?.[uuid] === true
                }),
                window.mmgisAPI.provide('tool:getVars', (toolName) => L_.getToolVars(toolName)),
                window.mmgisAPI.provide('app:isMobile', () => L_.UserInterface_?.isMobile === true),
                window.mmgisAPI.provide('app:getMissionPath', () => L_.missionPath),
                // Raw mission branding fields (title/logo). Resolution policy
                // (e.g. fallback order) is left to consumers, not baked in here.
                window.mmgisAPI.provide('app:getBranding', () => ({
                    pagename: L_.configData?.look?.pagename || null,
                    mission: L_.configData?.msv?.mission || null,
                    name: window.mmgisglobal?.name || null,
                    logoUrl: L_.configData?.look?.logourl || null,
                })),
            ]
        }
    },
    fullyLoaded: function () {
        this.selectPoint(this.FUTURES.activePoint)

        Search.init('.Search', L_, this.Viewer_, this.Map_, this.Globe_)
        Description.updateInfo()

        $('#main-container').animate(
            {
                filter: 'blur(0px)',
            },
            800,
            function () {
                $('#main-container').css('filter', 'blur(0px)')
            }
        )
        $('.LoadingPage').animate(
            {
                opacity: 0,
            },
            1400,
            function () {
                $('.LoadingPage').remove()
            }
        )
    },
    setSite: function (newSite, newView, dontSetGlobe) {
        if (newSite != undefined && newSite != null) {
            this.site = newSite
            if (newView != null) {
                this.view = newView

                if (this.FUTURES.activePoint == null) {
                    L_.Map_.resetView(newView)
                    if (!dontSetGlobe && L_.hasGlobe) {
                        L_.Globe_.litho.setCenter(newView)
                    }
                }
            }
        } else console.log('Failure updating to new site')
    },
    _timeChangeSubscriptions: {},
    subscribeTimeChange: function (fid, func) {
        if (typeof func === 'function') L_._timeChangeSubscriptions[fid] = func
    },
    unsubscribeTimeChange: function (fid) {
        if (L_._timeChangeSubscriptions[fid] != null)
            delete L_._timeChangeSubscriptions[fid]
    },
    _timeLayerReloadFinishSubscriptions: {},
    subscribeTimeLayerReloadFinish: function (fid, func) {
        if (typeof func === 'function')
            L_._timeLayerReloadFinishSubscriptions[fid] = func
    },
    unsubscribeTimeLayerReloadFinish: function (fid) {
        if (L_._timeLayerReloadFinishSubscriptions[fid] != null)
            delete L_._timeLayerReloadFinishSubscriptions[fid]
    },
    _onTimeUIToggleSubscriptions: {},
    subscribeOnTimeUIToggle: function (fid, func) {
        if (typeof func === 'function')
            L_._onTimeUIToggleSubscriptions[fid] = func
    },
    unsubscribeOnTimeUIToggle: function (fid) {
        if (L_._onTimeUIToggleSubscriptions[fid] != null)
            delete L_._onTimeUIToggleSubscriptions[fid]
    },
    _onLayerToggleSubscriptions: {},
    subscribeOnLayerToggle: function (fid, func) {
        if (typeof func === 'function')
            L_._onLayerToggleSubscriptions[fid] = func
    },
    unsubscribeOnLayerToggle: function (fid) {
        if (L_._onLayerToggleSubscriptions[fid] != null)
            delete L_._onLayerToggleSubscriptions[fid]
    },
    _onSpecificLayerToggleSubscriptions: {},
    subscribeOnSpecificLayerToggle: function (fid, layerId, func) {
        if (typeof func === 'function')
            L_._onSpecificLayerToggleSubscriptions[fid] = {
                layer: layerId,
                func: func,
            }
    },
    unsubscribeOnSpecificLayerToggle: function (fid) {
        if (L_._onSpecificLayerToggleSubscriptions[fid] != null)
            delete L_._onSpecificLayerToggleSubscriptions[fid]
    },
    /**
     * Transforms a STAC collection URL (stac-collection:name?params) into a proper HTTP URL
     * for TiTiler PgSTAC endpoints.
     *
     * @param {string} url - The URL to transform (may or may not be a stac-collection: URL)
     * @param {object} layerConfig - The layer configuration object
     * @param {string} type - The type of endpoint to generate ('tile' or 'image')
     * @returns {string} - The transformed URL or the original URL if not a STAC URL
     */
    transformStacUrl(url, layerConfig, type = 'tile') {
        if (!url || typeof url !== 'string') return url

        // Check if this is a STAC collection URL
        const lowerUrl = url.toLowerCase()
        if (!lowerUrl.startsWith('stac-collection:')) return url

        // Parse the STAC URL: stac-collection:collection_name?params
        const splitColonUrl = url.split(':')
        if (splitColonUrl.length < 2) return url

        const splitParams = splitColonUrl[1].split('?')
        const collectionName = splitParams[0]

        // Build bands parameter (only if no expression exists)
        let bandsParam = ''
        if (
            layerConfig &&
            (!layerConfig.cogExpression ||
                layerConfig.cogExpression.trim() === '')
        ) {
            const bands = layerConfig.cogBands
            if (bands != null) {
                bands.forEach((band) => {
                    if (band != null) bandsParam += `&bidx=${band}`
                })
            }
        }

        // Build resampling parameter
        let resamplingParam = ''
        if (layerConfig && layerConfig.cogResampling) {
            resamplingParam = `&resampling=${layerConfig.cogResampling}`
        }

        // Build the base URL using ServiceUrls (supports external endpoints)
        const baseUrl = ServiceUrls.getTiTilerPgStacUrl(layerConfig)

        // Generate different endpoints based on type
        if (type === 'tile') {
            // Tile endpoint for raster tiles
            return `${baseUrl}/collections/${collectionName}/tiles/${
                (layerConfig && layerConfig.tileMatrixSet) || 'WebMercatorQuad'
            }/{z}/{x}/{y}?assets=asset${bandsParam}${resamplingParam}`
        } else {
            // For images, we use preview endpoint
            // Note: STAC collections are typically designed for tile serving
            if (layerConfig && layerConfig.name) {
                console.warn(
                    `STAC layer "${layerConfig.name}" is configured as an image layer. ` +
                        `STAC collections work best with tile layer type. ` +
                        `Attempting to use preview endpoint.`
                )
            }
            return `${baseUrl}/collections/${collectionName}/preview?assets=asset${bandsParam}${resamplingParam}`
        }
    },
    getUrl: function (type, url, layerConfig) {
        let wasCOG = false

        let nextUrl = url

        // Handle STAC collection URLs using shared transformation function
        if (
            nextUrl != null &&
            nextUrl.toLowerCase().startsWith('stac-collection:')
        ) {
            nextUrl = L_.transformStacUrl(nextUrl, layerConfig, type)
            // After transformation, nextUrl is now an absolute HTTP URL
        }

        if (nextUrl != null && nextUrl.startsWith('COG:')) {
            nextUrl = nextUrl.slice(4)
            wasCOG = true
        }
        if (nextUrl != null && nextUrl.startsWith('titiler-url:')) {
            nextUrl = nextUrl.slice(12)
        }
        if (!F_.isUrlAbsolute(nextUrl)) {
            nextUrl = L_.missionPath + nextUrl
        }
        if (
            type === 'tile' &&
            ((layerConfig && layerConfig.throughTileServer === true) ||
                wasCOG === true)
        ) {
            if (
                !F_.isUrlAbsolute(nextUrl) &&
                window.mmgisglobal.IS_DOCKER !== 'true'
            ) {
                nextUrl = `../../${nextUrl}`
            } else if (
                !F_.isUrlAbsolute(nextUrl) &&
                window.mmgisglobal.IS_DOCKER === 'true'
            ) {
                nextUrl = `/${nextUrl}`
            }
        }
        if (process.env.NODE_ENV === 'development' && F_.isUrlAbsolute(nextUrl)) {
            try {
                if (new URL(nextUrl).origin !== window.location.origin) {
                    const rootPath = window?.mmgisglobal?.ROOT_PATH || ''
                    nextUrl = `${rootPath}/corsproxy/${nextUrl}`
                }
            } catch (e) {
                // Invalid URL, leave unchanged
            }
        }
        return nextUrl
    },
    //Takes in config layer obj
    //Toggles a layer on and off and accounts for sublayers
    //Takes in a config layer object
    toggleLayer: async function (
        layerConfig,
        skipOrderedBringToFront,
        ignoreToggleStateChange
    ) {
        if (layerConfig == null) return

        const wasNeverOn = L_.layers.layer[layerConfig.name] === false

        let on //if on -> turn off //if off -> turn on
        if (L_.layers.on[layerConfig.name] === true) on = true
        else on = false

        await L_.toggleLayerHelper(
            layerConfig,
            on,
            ignoreToggleStateChange,
            null,
            skipOrderedBringToFront
        )

        Object.keys(L_._onLayerToggleSubscriptions).forEach((k) => {
            L_._onLayerToggleSubscriptions[k](layerConfig.name, !on)
        })

        Object.keys(L_._onSpecificLayerToggleSubscriptions).forEach((k) => {
            const subs = L_._onSpecificLayerToggleSubscriptions[k]
            if (subs.layer === layerConfig.name)
                subs.func(layerConfig.name, !on)
        })

        // Always reupdate layer infos at the end to keep them in sync
        Description.updateInfo()

        // Update attributions display
        if (typeof Attributions !== 'undefined' && Attributions.update) {
            Attributions.update()
        }

        // Deselect active feature if its layer is being turned off
        if (
            L_.activeFeature &&
            L_.activeFeature.layerName === layerConfig.name &&
            on
        ) {
            L_.setActiveFeature(null)
        }

        // Make new vector layer match time constraints
        if (
            wasNeverOn &&
            layerConfig.type === 'vector' &&
            layerConfig.time.type === 'local' &&
            layerConfig.time.endProp != null &&
            layerConfig.controlled !== true
        ) {
            L_.timeFilterVectorLayer(
                layerConfig.name,
                new Date(layerConfig.time.start).getTime(),
                new Date(layerConfig.time.end).getTime()
            )
        }
    },
    toggleLayerHelper: async function (
        layerConfig,
        on,
        ignoreToggleStateChange,
        globeOnly,
        skipOrderedBringToFront
    ) {
        if (layerConfig.type !== 'header') {
            if (on) {
                if (
                    L_.Map_.map.hasLayer(L_.layers.layer[layerConfig.name]) &&
                    globeOnly != true
                ) {
                    // Only close DrawTool Edit Panel if this is a user-initiated toggle, not a refresh
                    if (!ignoreToggleStateChange) {
                        try {
                            $('.drawToolContextMenuHeaderClose').click()
                        } catch (err) {}
                    }
                    if (
                        L_.Map_.engine &&
                        L_.Map_.engine.engineType !== 'leaflet'
                    ) {
                        L_.Map_.engine.updateLayer(
                            L_.Map_.nativeLayer(
                                L_.layers.layer[layerConfig.name]
                            ),
                            { visible: false }
                        )
                    } else {
                        L_.Map_.rmNotNull(L_.layers.layer[layerConfig.name])
                    }
                    if (L_.layers.attachments[layerConfig.name]) {
                        for (let sublayerName in L_.layers.attachments[
                            layerConfig.name
                        ]) {
                            switch (
                                L_.layers.attachments[layerConfig.name][
                                    sublayerName
                                ].type
                            ) {
                                case 'model':
                                    L_.Globe_.litho.removeLayer(
                                        L_.layers.attachments[layerConfig.name][
                                            sublayerName
                                        ].layerId
                                    )
                                    break
                                case 'uncertainty_ellipses':
                                    L_.Globe_.litho.removeLayer(
                                        L_.layers.attachments[layerConfig.name][
                                            sublayerName
                                        ].curtainLayerId
                                    )
                                    L_.Globe_.litho.removeLayer(
                                        L_.layers.attachments[layerConfig.name][
                                            sublayerName
                                        ].clampedLayerId
                                    )
                                    L_.Map_.rmNotNull(
                                        L_.layers.attachments[layerConfig.name][
                                            sublayerName
                                        ].layer
                                    )
                                    break
                                case 'labels':
                                case 'pairings':
                                    L_.layers.attachments[layerConfig.name][
                                        sublayerName
                                    ].layer.off()
                                    break
                                default:
                                    L_.Map_.rmNotNull(
                                        L_.layers.attachments[layerConfig.name][
                                            sublayerName
                                        ].layer
                                    )
                                    break
                            }
                        }
                    }
                }
                if (layerConfig.type === 'model') {
                    L_.Globe_.litho.toggleLayer(layerConfig.name, false)
                } else L_.Globe_.litho.removeLayer(layerConfig.name)
            } else {
                if (
                    L_.layers.layer[layerConfig.name] &&
                    globeOnly != true &&
                    layerConfig.type !== 'velocity'
                ) {
                    if (L_.layers.attachments[layerConfig.name]) {
                        for (let sublayerName in L_.layers.attachments[
                            layerConfig.name
                        ]) {
                            if (
                                L_.layers.attachments[layerConfig.name][
                                    sublayerName
                                ].on
                            ) {
                                switch (
                                    L_.layers.attachments[layerConfig.name][
                                        sublayerName
                                    ].type
                                ) {
                                    case 'model':
                                        L_.Globe_.litho.addLayer(
                                            'model',
                                            L_.layers.attachments[
                                                layerConfig.name
                                            ][sublayerName].modelOptions
                                        )
                                        break
                                    case 'uncertainty_ellipses':
                                        L_.Globe_.litho.addLayer(
                                            'curtain',
                                            L_.layers.attachments[
                                                layerConfig.name
                                            ][sublayerName].curtainOptions
                                        )
                                        L_.Globe_.litho.addLayer(
                                            'clamped',
                                            L_.layers.attachments[
                                                layerConfig.name
                                            ][sublayerName].clampedOptions
                                        )
                                        L_.Map_.engine.addLayer(
                                            L_.Map_.nativeLayer(
                                                L_.layers.attachments[
                                                    layerConfig.name
                                                ][sublayerName].layer
                                            )
                                        )
                                        L_.Map_.engine.setLayerZIndex(
                                            L_.Map_.nativeLayer(
                                                L_.layers.attachments[
                                                    layerConfig.name
                                                ][sublayerName].layer
                                            ),
                                            L_._layersOrdered.length +
                                                1 -
                                                L_._layersOrdered.indexOf(
                                                    layerConfig.name
                                                )
                                        )
                                        break
                                    case 'labels':
                                    case 'pairings':
                                        if (
                                            L_.layers.attachments[
                                                layerConfig.name
                                            ][sublayerName].layer
                                        )
                                            L_.layers.attachments[
                                                layerConfig.name
                                            ][sublayerName].layer.on(
                                                false,
                                                L_.layers.attachments[
                                                    layerConfig.name
                                                ][sublayerName].layer
                                            )
                                        break
                                    default:
                                        L_.Map_.engine.addLayer(
                                            L_.Map_.nativeLayer(
                                                L_.layers.attachments[
                                                    layerConfig.name
                                                ][sublayerName].layer
                                            )
                                        )
                                        L_.Map_.engine.setLayerZIndex(
                                            L_.Map_.nativeLayer(
                                                L_.layers.attachments[
                                                    layerConfig.name
                                                ][sublayerName].layer
                                            ),
                                            L_._layersOrdered.length +
                                                1 -
                                                L_._layersOrdered.indexOf(
                                                    layerConfig.name
                                                )
                                        )
                                        break
                                }
                            }
                        }
                    }

                    const nativeLayer = L_.Map_.nativeLayer(
                        L_.layers.layer[layerConfig.name]
                    )
                    if (L_.Map_.engine.engineType !== 'leaflet') {
                        if (!L_.Map_.engine.updateLayer(nativeLayer, { visible: true })) {
                            L_.Map_.engine.addLayer(nativeLayer)
                        }
                    } else {
                        L_.Map_.engine.addLayer(nativeLayer)
                    }
                    L_.Map_.engine.setLayerZIndex(
                        L_.Map_.nativeLayer(L_.layers.layer[layerConfig.name]),
                        L_._layersOrdered.length +
                            1 -
                            L_._layersOrdered.indexOf(layerConfig.name)
                    )
                }

                if (layerConfig.type === 'tile') {
                    let layerUrl = L_.getUrl(
                        layerConfig.type,
                        layerConfig.url,
                        layerConfig
                    )
                    let demUrl = L_.getUrl(
                        layerConfig.type,
                        layerConfig.demtileurl,
                        layerConfig
                    )
                    if (
                        layerConfig.demtileurl == undefined ||
                        layerConfig.demtileurl.length == 0
                    )
                        demUrl = undefined
                    L_.Globe_.litho.addLayer('tile', {
                        name: layerConfig.name,
                        order: L_._layersOrdered,
                        on: L_.layers.opacity[layerConfig.name],
                        format: layerConfig.tileformat || 'tms',
                        formatOptions: {},
                        demFormat: layerConfig.tileformat || 'tms',
                        demFormatOptions: {
                            correctSeams: layerConfig.tileformat === 'wms',
                            wmsParams: {},
                        },
                        parser: layerConfig.demparser || null,
                        path: layerUrl,
                        demPath: demUrl,
                        opacity: L_.layers.opacity[layerConfig.name],
                        minZoom: layerConfig.minZoom,
                        maxZoom: layerConfig.maxNativeZoom,
                        //boundingBox: layerConfig.boundingBox,
                        time: layerConfig.time,
                    })
                } else if (layerConfig.type === 'data') {
                } else if (layerConfig.type === 'model') {
                    if (L_.Globe_.litho.hasLayer(layerConfig.name)) {
                        L_.Globe_.litho.toggleLayer(layerConfig.name, true)
                    } else {
                        let modelUrl = layerConfig.url
                        if (!F_.isUrlAbsolute(modelUrl))
                            modelUrl = L_.missionPath + modelUrl
                        L_.Globe_.litho.addLayer('model', {
                            name: layerConfig.name,
                            order: 1,
                            on: true,
                            path: modelUrl,
                            opacity: layerConfig.initialOpacity,
                            position: {
                                longitude: layerConfig.position?.longitude || 0,
                                latitude: layerConfig.position?.latitude || 0,
                                elevation: layerConfig.position?.elevation || 0,
                            },
                            scale: layerConfig.scale || 1,
                            rotation: {
                                // y-up is away from planet center. x is pitch, y is yaw, z is roll
                                x: layerConfig.rotation?.x || 0,
                                y: layerConfig.rotation?.y || 0,
                                z: layerConfig.rotation?.z || 0,
                            },
                        })
                    }
                } else if (layerConfig.type === 'velocity') {
                    if (
                        ['streamlines', 'particles'].includes(layerConfig.kind)
                    ) {
                        L_.Map_.rmNotNull(L_.layers.layer[layerConfig.name])
                    }
                    await L_.Map_.makeLayer(layerConfig, true, null, null, true)
                    Description.updateInfo()
                    L_.Map_.engine.addLayer(
                        L_.Map_.nativeLayer(L_.layers.layer[layerConfig.name])
                    )
                    L_.Map_.engine.setLayerZIndex(
                        L_.Map_.nativeLayer(L_.layers.layer[layerConfig.name]),
                        L_._layersOrdered.length +
                            1 -
                            L_._layersOrdered.indexOf(layerConfig.name)
                    )
                } else {
                    let hadToMake = false
                    if (
                        L_.layers.layer[layerConfig.name] === false &&
                        globeOnly != true
                    ) {
                        await L_.Map_.makeLayer(
                            layerConfig,
                            true,
                            null,
                            null,
                            true
                        )
                        Description.updateInfo()
                        hadToMake = true
                    }
                    if (L_.layers.layer[layerConfig.name]) {
                        if (globeOnly != true) {
                            if (!hadToMake) {
                                // Refresh annotation popups
                                if (L_.layers.layer[layerConfig.name]._layers)
                                    Object.keys(
                                        L_.layers.layer[layerConfig.name]
                                            ._layers
                                    ).forEach((key) => {
                                        const l =
                                            L_.layers.layer[layerConfig.name]
                                                ._layers[key]
                                        if (l._isAnnotation) {
                                            L_.layers.layer[
                                                layerConfig.name
                                            ]._layers[key] =
                                                L_.createAnnotation(
                                                    l._annotationParams
                                                        .feature,
                                                    l._annotationParams
                                                        .className,
                                                    l._annotationParams.layerId,
                                                    l._annotationParams.id1
                                                )
                                        }
                                    })
                            }
                            const nativeLayer = L_.Map_.nativeLayer(
                                L_.layers.layer[layerConfig.name]
                            )
                            if (L_.Map_.engine.engineType !== 'leaflet') {
                                if (!L_.Map_.engine.updateLayer(nativeLayer, { visible: true })) {
                                    L_.Map_.engine.addLayer(nativeLayer)
                                }
                            } else {
                                L_.Map_.engine.addLayer(nativeLayer)
                            }
                            L_.Map_.engine.setLayerZIndex(
                                L_.Map_.nativeLayer(
                                    L_.layers.layer[layerConfig.name]
                                ),
                                L_._layersOrdered.length +
                                    1 -
                                    L_._layersOrdered.indexOf(layerConfig.name)
                            )
                        }

                        if (layerConfig.type === 'image') {
                            if (
                                L_.layers.layer[layerConfig.name].options
                                    .pixelValuesToColorFn &&
                                L_.layers.layer[layerConfig.name].options
                                    .pixelValuesToColorFn !== null
                            ) {
                                L_.layers.layer[layerConfig.name].clearCache()
                                L_.layers.layer[layerConfig.name].updateColors(
                                    L_.layers.layer[layerConfig.name].options
                                        .pixelValuesToColorFn
                                )
                                // Redraw the layer or the image will not refresh again unless zooming in/out
                                L_.layers.layer[layerConfig.name].redraw()
                            }
                        }

                        if (layerConfig.type === 'vector') {
                            L_.Globe_.litho.addLayer(
                                layerConfig.layer3dType || 'clamped',
                                {
                                    name: layerConfig.name,
                                    order: L_._layersOrdered, // Since higher order in litho is on top
                                    on: L_.layers.opacity[layerConfig.name]
                                        ? true
                                        : false,
                                    geojson: L_.layers.layer[
                                        layerConfig.name
                                    ].toGeoJSON(L_.GEOJSON_PRECISION),
                                    onClick: (feature, lnglat, layer) => {
                                        this.selectFeature(layer.name, feature)
                                    },
                                    useKeyAsHoverName: layerConfig.useKeyAsName,
                                    style: {
                                        // Prefer feature[f].properties.style values
                                        letPropertiesStyleOverride: true, // default false
                                        default: {
                                            fillColor:
                                                layerConfig.style.fillColor, //Use only rgb and hex. No css color names
                                            fillOpacity: parseFloat(
                                                layerConfig.style.fillOpacity
                                            ),
                                            color: layerConfig.style.color,
                                            weight: layerConfig.style.weight,
                                            radius: layerConfig.radius,
                                        },
                                        bearing:
                                            (layerConfig.variables
                                                ?.markerAttachments?.bearing &&
                                                layerConfig.variables
                                                    ?.markerAttachments
                                                    ?.bearing.enabled ==
                                                    null) ||
                                            layerConfig.variables
                                                ?.markerAttachments?.bearing
                                                ?.enabled === true
                                                ? layerConfig.variables
                                                      .markerAttachments.bearing
                                                : null,
                                    },
                                    opacity:
                                        L_.layers.opacity[layerConfig.name],
                                    minZoom:
                                        layerConfig.visibilitycutoff > 0
                                            ? layerConfig.visibilitycutoff
                                            : 0,
                                    maxZoom:
                                        layerConfig.visibilitycutoff < 0
                                            ? layerConfig.visibilitycutoff
                                            : 100,
                                }
                            )
                        }
                    }
                }
            }
        }

        if (globeOnly != true) {
            if (!ignoreToggleStateChange) {
                if (on) L_.layers.on[layerConfig.name] = false
                if (!on) L_.layers.on[layerConfig.name] = true
            }

            if (layerConfig.type === 'vector')
                L_._updatePairings(layerConfig.name, !on)

            if (
                !on &&
                layerConfig.type === 'vector' &&
                skipOrderedBringToFront !== true
            ) {
                L_.Map_.orderedBringToFront()
            }
            L_._refreshAnnotationEvents()

            // Toggling rereveals hidden features, so make sure they stay hidden
            if (L_.toggledOffFeatures && L_.toggledOffFeatures.length > 0) {
                L_.toggledOffFeatures.forEach((f) => {
                    L_.toggleFeature(f, false)
                })
            }
        }
        // Refresh opacity
        if (layerConfig.type === 'vector') {
            L_.setLayerOpacity(
                layerConfig.name,
                L_.layers.opacity[layerConfig.name]
            )
        }
    },
    _refreshAnnotationEvents() {
        // Add annotation click events since onEachFeatureDefault doesn't apply to popups
        $('.mmgisAnnotation').off('click')
        $('.mmgisAnnotation').on('click', function () {
            const layerName = $(this).attr('layerId')
            const layerCode = $(this).attr('layer')
            const layer = L_.layers.layer[layerName]._layers[layerCode]
            L_.Map_.featureDefaultClick(layer.feature, layer, {
                latlng: layer._latlng,
            })
        })
    },
    // If opacity is null, reinforces opacities
    setSublayerOpacity(layerName, sublayerName, opacity) {
        layerName = L_.asLayerUUID(layerName)

        const sublayers = L_.layers.attachments[layerName] || {}
        const sublayer = sublayers[sublayerName]

        if (opacity == null) opacity = sublayer?.opacity

        if (sublayer && sublayer.opacity != null) {
            sublayer.opacity = opacity
            switch (sublayer.type) {
                case 'image_overlays':
                    $(`.${sublayer.type}_${layerName}`).css({
                        opacity: opacity,
                    })
                    break
                default:
                    break
            }
        }
    },
    toggleSublayer: function (layerName, sublayerName) {
        layerName = L_.asLayerUUID(layerName)

        const sublayers = L_.layers.attachments[layerName] || {}
        const sublayer = sublayers[sublayerName]
        if (sublayer) {
            if (sublayer.on === true) {
                switch (sublayer.type) {
                    case 'model':
                        L_.Globe_.litho.removeLayer(sublayer.layerId)
                        break
                    case 'uncertainty_ellipses':
                        L_.Globe_.litho.removeLayer(sublayer.curtainLayerId)
                        L_.Globe_.litho.removeLayer(sublayer.clampedLayerId)
                        L_.Map_.rmNotNull(sublayer.layer)
                        break
                    case 'labels':
                    case 'pairings':
                        sublayer.layer.off()
                        break
                    default:
                        L_.Map_.rmNotNull(sublayer.layer)
                        break
                }
                sublayer.on = false
            } else {
                switch (sublayer.type) {
                    case 'model':
                        L_.Globe_.litho.addLayer('model', sublayer.modelOptions)
                        break
                    case 'uncertainty_ellipses':
                        L_.Globe_.litho.addLayer(
                            'curtain',
                            sublayer.curtainOptions
                        )
                        L_.Globe_.litho.addLayer(
                            'clamped',
                            sublayer.clampedOptions
                        )
                        L_.Map_.engine.addLayer(
                            L_.Map_.nativeLayer(sublayer.layer)
                        )
                        L_.Map_.engine.setLayerZIndex(
                            L_.Map_.nativeLayer(sublayer.layer),
                            L_._layersOrdered.length +
                                1 -
                                L_._layersOrdered.indexOf(layerName)
                        )
                        break
                    case 'labels':
                    case 'pairings':
                        sublayer.layer.on(false, sublayer.layer)
                        break
                    default:
                        L_.Map_.engine.addLayer(
                            L_.Map_.nativeLayer(sublayer.layer)
                        )
                        L_.Map_.engine.setLayerZIndex(
                            L_.Map_.nativeLayer(sublayer.layer),
                            L_._layersOrdered.length +
                                1 -
                                L_._layersOrdered.indexOf(layerName)
                        )
                        L_.setSublayerOpacity(layerName, sublayerName)
                        break
                }
                sublayer.on = true
            }
        }
    },
    disableAllBut: function (siteName, skipDisabling) {
        if (L_.layers.data.hasOwnProperty(siteName)) {
            let layerConfig
            if (skipDisabling !== true) {
                for (let i = 0; i < L_.layers.dataFlat.length; i++) {
                    layerConfig = L_.layers.dataFlat[i]
                    if (L_.layers.on[layerConfig.name] == true) {
                        if (layerConfig.name != 'Mars Overview')
                            L_.toggleLayer(layerConfig)
                    }
                    if (L_.layers.on['Mars Overview'] === false) {
                        if (layerConfig.name === 'Mars Overview')
                            L_.toggleLayer(layerConfig)
                    }
                }
            }

            for (let n in L_._layersParent) {
                if (L_._layersParent[n] === siteName && L_.layers.data[n]) {
                    layerConfig = L_.layers.data[n]
                    if (
                        layerConfig.visibility === true && // initial visibility
                        L_.layers.on[layerConfig.name] === false
                    ) {
                        L_.toggleLayer(layerConfig)
                    }
                }
            }
        }
    },
    // Simply if visibility was set as true in the json,
    // add the layer
    // onlyTheseLayers: ['array', 'of', 'layer', 'names']
    addVisible: function (map_, onlyTheseLayers) {
        var engine = null
        if (map_ == null) {
            if (L_.Map_ == null) {
                console.warn(
                    "Can't addVisible layers before Map_ is initialized."
                )
                return
            }
            engine = L_.Map_.engine
        } else {
            engine = map_.engine
        }
        if (engine == null) {
            console.warn(
                "Can't addVisible layers before map engine is initialized."
            )
            return
        }
        for (var i = L_.layers.dataFlat.length - 1; i >= 0; i--) {
            if (
                (onlyTheseLayers == null ||
                    onlyTheseLayers.includes(L_.layers.dataFlat[i].name)) &&
                L_.layers.on[L_.layers.dataFlat[i].name] === true &&
                (L_.layers.dataFlat[i].type === 'model' ||
                    L_.layers.layer[L_.layers.dataFlat[i].name] != null)
            ) {
                // Add Map layers
                if (L_.layers.layer[L_.layers.dataFlat[i].name]) {
                    try {
                        if (L_.layers.attachments[L_.layers.dataFlat[i].name]) {
                            for (let sublayerName in L_.layers.attachments[
                                L_.layers.dataFlat[i].name
                            ]) {
                                const sublayer =
                                    L_.layers.attachments[
                                        L_.layers.dataFlat[i].name
                                    ][sublayerName]
                                if (sublayer.on) {
                                    switch (sublayer.type) {
                                        case 'model':
                                            L_.Globe_.litho.addLayer(
                                                'model',
                                                sublayer.modelOptions
                                            )
                                            break
                                        case 'uncertainty_ellipses':
                                            L_.Globe_.litho.addLayer(
                                                'curtain',
                                                sublayer.curtainOptions
                                            )
                                            L_.Globe_.litho.addLayer(
                                                'clamped',
                                                sublayer.clampedOptions
                                            )
                                            engine.addLayer(
                                                L_.Map_.nativeLayer(
                                                    sublayer.layer
                                                )
                                            )
                                            break
                                        case 'labels':
                                        case 'pairings':
                                            if (sublayer.layer)
                                                sublayer.layer.on(
                                                    false,
                                                    sublayer.layer
                                                )
                                            break
                                        default:
                                            engine.addLayer(
                                                L_.Map_.nativeLayer(
                                                    sublayer.layer
                                                )
                                            )
                                            break
                                    }
                                }
                            }
                        }
                        engine.addLayer(
                            L_.Map_.nativeLayer(
                                L_.layers.layer[L_.layers.dataFlat[i].name]
                            )
                        )

                        // Ensure video layers start muted when added to map
                        if (L_.layers.dataFlat[i].type === 'video') {
                            const videoLayer =
                                L_.layers.layer[L_.layers.dataFlat[i].name]
                            if (videoLayer && videoLayer.getElement) {
                                const videoElement = videoLayer.getElement()
                                if (videoElement) {
                                    videoElement.muted = true
                                    videoElement.setAttribute('muted', 'true')
                                }
                            }
                        }
                        // Refresh opacity
                        if (L_.layers.dataFlat[i].type === 'vector') {
                            const lname = L_.layers.dataFlat[i].name
                            setTimeout(() => {
                                L_.setLayerOpacity(
                                    lname,
                                    L_.layers.opacity[lname]
                                )
                            }, 300)
                        }
                    } catch (e) {
                        console.log(e)
                        console.warn(
                            'Warning: Failed to add layer to map: ' +
                                L_.layers.dataFlat[i].name
                        )
                    }
                }

                // Add Globe layers
                const layerConfig = L_.layers.dataFlat[i]
                let layerUrl = layerConfig.url
                if (!F_.isUrlAbsolute(layerUrl))
                    layerUrl = L_.missionPath + layerUrl
                if (
                    layerConfig.type === 'tile' ||
                    layerConfig.type === 'data' ||
                    layerConfig.type === 'vectortile'
                ) {
                    // Make sure all tile layers follow z-index order at start instead of element order
                    engine.setLayerZIndex(
                        L_.Map_.nativeLayer(L_.layers.layer[layerConfig.name]),
                        L_._layersOrdered.length +
                            1 -
                            L_._layersOrdered.indexOf(layerConfig.name)
                    )

                    let demUrl = layerConfig.demtileurl
                    if (!F_.isUrlAbsolute(demUrl))
                        demUrl = L_.missionPath + demUrl
                    if (layerConfig.demtileurl == undefined)
                        demUrl = undefined
                    if (layerConfig.type === 'tile')
                        L_.Globe_.litho.addLayer('tile', {
                            name: layerConfig.name,
                            order: L_._layersOrdered,
                            on: L_.layers.opacity[layerConfig.name],
                            format: layerConfig.tileformat || 'tms',
                            formatOptions: {},
                            demFormat: layerConfig.tileformat || 'tms',
                            demFormatOptions: {
                                correctSeams:
                                    layerConfig.tileformat === 'wms',
                                wmsParams: {},
                            },
                            parser: layerConfig.demparser || null,
                            path: layerUrl,
                            demPath: demUrl,
                            opacity: L_.layers.opacity[layerConfig.name],
                            minZoom: layerConfig.minZoom,
                            maxZoom: layerConfig.maxNativeZoom,
                            //boundingBox: layerConfig.boundingBox,
                            time: layerConfig.time,
                        })
                } else if (layerConfig.type === 'model') {
                    L_.Globe_.litho.addLayer('model', {
                        name: layerConfig.name,
                        order: L_._layersOrdered,
                        on: true,
                        path: layerUrl,
                        opacity: L_.layers.opacity[layerConfig.name],
                        position: {
                            longitude: layerConfig.position?.longitude || 0,
                            latitude: layerConfig.position?.latitude || 0,
                            elevation: layerConfig.position?.elevation || 0,
                        },
                        scale: layerConfig.scale || 1,
                        rotation: {
                            // y-up is away from planet center. x is pitch, y is yaw, z is roll
                            x: layerConfig.rotation?.x || 0,
                            y: layerConfig.rotation?.y || 0,
                            z: layerConfig.rotation?.z || 0,
                        },
                    })
                } else if (layerConfig.type != 'header') {
                    if (
                        typeof L_.layers.layer[layerConfig.name].toGeoJSON ===
                        'function'
                    )
                        L_.Globe_.litho.addLayer(
                            layerConfig.type == 'vector'
                                ? layerConfig.layer3dType || 'clamped'
                                : layerConfig.type,
                            {
                                name: layerConfig.name,
                                order: L_._layersOrdered, // Since higher order in litho is on top
                                on: L_.layers.opacity[layerConfig.name]
                                    ? true
                                    : false,
                                geojson: L_.layers.layer[
                                    layerConfig.name
                                ].toGeoJSON(L_.GEOJSON_PRECISION),
                                onClick: (feature, lnglat, layer) => {
                                    this.selectFeature(layer.name, feature)
                                },
                                useKeyAsHoverName: layerConfig.useKeyAsName,
                                style: {
                                    // Prefer feature[f].properties.style values
                                    letPropertiesStyleOverride: true, // default false
                                    default: {
                                        fillColor: layerConfig.style?.fillColor, //Use only rgb and hex. No css color names
                                        fillOpacity: parseFloat(
                                            layerConfig.style?.fillOpacity
                                        ),
                                        color: layerConfig.style?.color,
                                        weight: layerConfig.style?.weight,
                                        radius: layerConfig.radius,
                                    },
                                    bearing:
                                        (layerConfig.variables
                                            ?.markerAttachments?.bearing &&
                                            layerConfig.variables
                                                ?.markerAttachments?.bearing
                                                .enabled == null) ||
                                        layerConfig.variables
                                            ?.markerAttachments?.bearing
                                            ?.enabled === true
                                            ? layerConfig.variables
                                                  .markerAttachments.bearing
                                            : null,
                                },
                                opacity: L_.layers.opacity[layerConfig.name],
                                minZoom:
                                    layerConfig.visibilitycutoff > 0
                                        ? layerConfig.visibilitycutoff
                                        : null,
                                maxZoom:
                                    layerConfig.visibilitycutoff < 0
                                        ? layerConfig.visibilitycutoff
                                        : null,
                            }
                        )
                }
            }
        }

        L_._refreshAnnotationEvents()
    },
    addGeoJSONData: function (layer, geojson, keepLastN, stopLoops) {
        if (layer._sourceGeoJSON) {
            if (layer._sourceGeoJSON.features)
                if (geojson.features)
                    layer._sourceGeoJSON.features =
                        layer._sourceGeoJSON.features.concat(geojson.features)
                else layer._sourceGeoJSON.features.push(geojson)
            else
                layer._sourceGeoJSON = F_.getBaseGeoJSON(
                    geojson.features
                        ? geojson.features
                        : geojson.length > 0 && geojson[0].type === 'Feature'
                          ? geojson
                          : null
                )
            if (keepLastN && keepLastN > 0) {
                layer._sourceGeoJSON.features =
                    layer._sourceGeoJSON.features.slice(-1 * keepLastN)
            }
        }

        // Don't add data if hidden
        if (
            L_.layers.data[layer._layerName] &&
            F_.getIn(
                L_.layers.data[layer._layerName],
                'variables.hideMainFeature'
            ) === true
        )
            return
        const initialOn = L_.layers.on[layer._layerName]
        // Remove layer
        L_.Map_.rmNotNull(L_.layers.layer[layer._layerName])
        // Remove sublayers
        L_.syncSublayerData(layer._layerName, true)
        // Remake Layer
        L_.Map_.makeLayer(
            L_.layers.data[layer._layerName],
            true,
            layer._sourceGeoJSON,
            null,
            null,
            stopLoops
        )

        if (initialOn) {
            L_.toggleLayerHelper(L_.layers.data[layer._layerName], false)
            L_.layers.on[layer._layerName] = true
        }
        //L_.syncSublayerData(layer._layerName)
        if (initialOn) {
            // Reselect activeFeature
            if (L_.activeFeature) {
                L_.selectFeature(
                    L_.activeFeature.layerName,
                    L_.activeFeature.feature
                )
            }
        }
    },
    clearGeoJSONData: function (layer) {
        if (layer._sourceGeoJSON) layer._sourceGeoJSON = F_.getBaseGeoJSON()
        layer.clearLayers()

        // If for some reason we still have layers, explicitly clear them
        if (Object.keys(layer._layers).length > 0) {
            layer.eachLayer((innerLayer) => {
                if (innerLayer._layers) innerLayer.clearLayers()
                if (layer.hasLayer(innerLayer)) layer.removeLayer(innerLayer)
                else {
                    L_.Map_.rmNotNull(innerLayer)
                }
            })
            layer._layers = {}
        }
    },
    setStyle(layer, newStyle) {
        try {
            layer.setStyle(newStyle)
        } catch (err) {}
    },
    setActiveFeature(layer) {
        if (layer && layer.feature && layer.options?.layerName)
            L_.activeFeature = {
                feature: layer.feature,
                layerName: layer.options.layerName,
                layer: layer,
            }
        else L_.activeFeature = null

        L_.setLastActiveFeature(layer)
        L_.resetLayerFills()
        L_.highlight(layer)
        L_.Map_.activeLayer = layer

        if (L_.Map_.activeLayer) L_.Map_._justSetActiveLayer = true

        Description.updatePoint(L_.Map_.activeLayer)

        if (layer) {
            const props = layer.feature?.properties || layer.properties || {}

            // Highlight the feature in Globe
            if (
                L_.Globe_ &&
                L_.Globe_.highlight &&
                layer.feature &&
                layer.options?.layerName
            ) {
                L_.Globe_.highlight(layer.options.layerName, layer.feature)
            }

            L_.Viewer_.highlight(layer)
        }

        ToolController_.notifyActiveTool('setActiveFeature', L_.activeFeature)

        if (!L_.activeFeature) {
            L_.clearVectorLayerInfo()
        }
    },
    highlight(layer, forceColor) {
        if (layer == null) return
        const color =
            forceColor ||
            (L_.configData.look && L_.configData.look.highlightcolor) ||
            'red'
        try {
            if (
                layer.feature?.properties?.annotation === true &&
                layer._container
            ) {
                // Annotation
                $(layer._container)
                    .find('.mmgisAnnotation')
                    .css('color', 'lime')
            } else if (layer.feature?.properties?.arrow === true) {
                // Arrow
                $(`.LayerArrow_${layer._idx}.mmgisArrowOutline`).css(
                    'stroke',
                    color
                )
            } else {
                const savedOptions = JSON.parse(JSON.stringify(layer.options))
                layer.setStyle({
                    color: color,
                    stroke: color,
                    weight: 4,
                })
                layer.options = savedOptions

                // For some odd reason sometimes the first style does not work
                // This makes sure it does
                setTimeout(() => {
                    const savedOptions2 = JSON.parse(
                        JSON.stringify(layer.options)
                    )
                    if (
                        layer.options.color != color &&
                        layer.options.stroke != color
                    ) {
                        layer.setStyle({
                            color: color,
                            stroke: color,
                            weight: 4,
                        })
                        layer.options = savedOptions2
                    }
                }, 100)
            }
        } catch (err) {
            if (layer._icon)
                layer._icon.style.filter = `drop-shadow(${color}  2px 0px 0px) drop-shadow(${color}  -2px 0px 0px) drop-shadow(${color}  0px 2px 0px) drop-shadow(${color} 0px -2px 0px)`
        }
        try {
            //layer.bringToFront()
        } catch (err) {}
    },
    toggleFeature(layer, on) {
        const display = on ? 'inherit' : 'none'
        layer._hidden = !on
        let layers = [layer]

        if (layer.hasOwnProperty('_layers')) {
            // Arrow
            const innerLayers = layer._layers
            Object.keys(innerLayers).forEach((k) => {
                layers.push(innerLayers[k])
            })
        }

        if (layer._isArrow) {
            $(`.LayerArrow_${layer._idx}`).css('display', display)
        }

        layers.forEach((l) => {
            if (l._path) {
                l._path.style.display = display
            }
            if (l._container) {
                l._container.style.display = display
            }
            if (l._icon) {
                l._icon.style.display = display
            }
        })
        L_.toggledOffFeatures = L_.toggledOffFeatures || []
        const tofIdx = L_.toggledOffFeatures.indexOf(layer)

        if (layer._hidden && tofIdx === -1) L_.toggledOffFeatures.push(layer)
        else if (!layer._hidden && tofIdx >= 0) {
            L_.toggledOffFeatures.splice(tofIdx, 1)
        }
    },
    unhideAllFeatures() {
        if (L_.toggledOffFeatures) {
            for (let i = L_.toggledOffFeatures.length - 1; i >= 0; i--)
                L_.toggleFeature(L_.toggledOffFeatures[i], true)
        }
        L_.Map_.orderedBringToFront()
        L_.setActiveFeature(L_.activeFeature?.layer)
        L_._refreshAnnotationEvents()
    },
    /**
     *
     * @param {string[]} forceLayerNames - Enforce visibilities per layer
     */
    enforceVisibilityCutoffs: function (forceLayerNames) {
        const layerNames = forceLayerNames || Object.keys(L_.layers.layer)

        layerNames.forEach((layerName) => {
            const layerDisplayName = layerName
            layerName = L_.asLayerUUID(layerName)
            let layerConfig = L_.layers.data[layerName]
            let layer = L_.layers.layer[layerName]

            if (layerConfig == null && layerDisplayName.includes('DrawTool'))
                layerConfig = {
                    type: 'vector',
                }

            if (layer && layer.length == null) layer = [layer]

            // vector, loaded and on
            if (
                layerConfig != null &&
                layerConfig.type === 'vector' &&
                layer &&
                (L_.layers.data[layerName]
                    ? L_.Map_.map.hasLayer(L_.layers.layer[layerName])
                    : true)
            ) {
                let minZoom = null
                let maxZoom = null
                if (
                    layerConfig.hasOwnProperty('minZoom') ||
                    layerConfig.hasOwnProperty('maxZoom')
                ) {
                    minZoom =
                        layerConfig.minZoom != null ? layerConfig.minZoom : null
                    maxZoom =
                        layerConfig.maxZoom != null ? layerConfig.maxZoom : null
                } else if (layerConfig.hasOwnProperty('visibilitycutoff')) {
                    // Backwards compatibility
                    minZoom =
                        layerConfig.visibilitycutoff > 0
                            ? layerConfig.visibilitycutoff
                            : null
                    maxZoom =
                        layerConfig.visibilitycutoff < 0
                            ? layerConfig.visibilitycutoff
                            : null
                }

                minZoom = minZoom != null ? minZoom : 0
                maxZoom = maxZoom != null ? maxZoom : 100

                for (let i = 0; i < layer.length; i++) {
                    if (layer[i]) {
                        if (layer[i].feature) {
                            L_._setVisibilityCutoffInternal(
                                layer[i],
                                minZoom,
                                maxZoom
                            )
                        }
                        if (layer[i]._layers)
                            for (let layerId in layer[i]._layers) {
                                L_._setVisibilityCutoffInternal(
                                    layer[i]._layers[layerId],
                                    minZoom,
                                    maxZoom
                                )
                            }
                    }
                }
            }
        })
    },
    _setVisibilityCutoffInternal: function (featureLayer, minZoom, maxZoom) {
        if (featureLayer._hidden === true) return

        let featureMinZoom = null
        let featureMaxZoom = null
        if (featureLayer.feature?.properties?.style?.minZoom != null)
            featureMinZoom = featureLayer.feature.properties.style.minZoom
        if (featureLayer.feature?.properties?.style?.maxZoom != null)
            featureMaxZoom = featureLayer.feature.properties.style.maxZoom

        if (
            F_.isInZoomRange(
                featureMinZoom != null ? featureMinZoom : minZoom,
                featureMaxZoom != null ? featureMaxZoom : maxZoom,
                L_.Map_.map.getZoom()
            )
        ) {
            if (featureLayer._path)
                featureLayer._path.style.display = 'inherit'
            if (featureLayer._container)
                featureLayer._container.style.display = 'inherit'
            if (featureLayer._icon)
                featureLayer._icon.style.display = 'inherit'
        } else {
            if (featureLayer._path) featureLayer._path.style.display = 'none'
            if (featureLayer._container)
                featureLayer._container.style.display = 'none'
            if (featureLayer._icon) featureLayer._icon.style.display = 'none'
        }
    },
    addArrowToMap: function (
        layerId,
        start,
        end,
        style,
        feature,
        index,
        indexedCallback,
        withClass
    ) {
        const className = withClass ? `mmgisArrow LayerArrow_${index}` : ''
        const classNameOutline = withClass ? ' mmgisArrowOutline' : ''
        let line

        let length
        if (isNaN(style.length)) length = false
        else length = parseInt(style.length)

        line = new L.Polyline([end, start], {
            color: style.color,
            weight: style.width + style.weight,
        })
        let arrowBodyOutline
        if (length === false) {
            arrowBodyOutline = new L.Polyline([start, end], {
                color: style.color,
                weight: style.width + style.weight,
                dashArray: style.dashArray,
                lineCap: style.lineCap,
                lineJoin: style.lineJoin,
                className: className + classNameOutline,
            })
        } else {
            arrowBodyOutline = L.polylineDecorator(line, {
                patterns: [
                    {
                        offset: length / 2 + 'px',
                        repeat: 0,
                        symbol: L.Symbol.dash({
                            pixelSize: style.length,
                            polygon: false,
                            pathOptions: {
                                stroke: true,
                                color: style.color,
                                weight: style.width + style.weight,
                                dashArray: style.dashArray,
                                lineCap: style.lineCap,
                                lineJoin: style.lineJoin,
                                className: className + classNameOutline,
                            },
                        }),
                    },
                ],
            })
        }
        line = new L.Polyline([start, end], {
            color: style.color,
            weight: style.width + style.weight,
            className: className,
        })
        var arrowHeadOutline = L.polylineDecorator(line, {
            patterns: [
                {
                    offset: '100%',
                    repeat: 0,
                    symbol: L.Symbol.arrowHead({
                        pixelSize: style.radius,
                        polygon: false,
                        pathOptions: {
                            stroke: true,
                            color: style.color,
                            weight: style.width + style.weight,
                            lineCap: style.lineCap,
                            lineJoin: style.lineJoin,
                            className: className + classNameOutline,
                        },
                    }),
                },
            ],
        })
        line = new L.Polyline([end, start], {
            color: style.fillColor,
            weight: style.width,
            className: className,
        })
        var arrowBody
        if (length === false) {
            arrowBody = new L.Polyline([start, end], {
                color: style.fillColor,
                weight: style.width,
                dashArray: style.dashArray,
                lineCap: style.lineCap,
                lineJoin: style.lineJoin,
                className: className,
            })
        } else {
            arrowBody = L.polylineDecorator(line, {
                patterns: [
                    {
                        offset: length / 2 + 'px',
                        repeat: 0,
                        symbol: L.Symbol.dash({
                            pixelSize: style.length,
                            polygon: false,
                            pathOptions: {
                                stroke: true,
                                color: style.fillColor,
                                weight: style.width,
                                dashArray: style.dashArray,
                                lineCap: style.lineCap,
                                lineJoin: style.lineJoin,
                                className: className,
                            },
                        }),
                    },
                ],
            })
        }
        line = new L.Polyline([start, end], {
            color: style.fillColor,
            weight: style.width,
            className: className,
        })
        var arrowHead = L.polylineDecorator(line, {
            patterns: [
                {
                    offset: '100%',
                    repeat: 0,
                    symbol: L.Symbol.arrowHead({
                        pixelSize: style.radius,
                        polygon: false,
                        pathOptions: {
                            stroke: true,
                            color: style.fillColor,
                            weight: style.width,
                            lineCap: style.lineCap,
                            lineJoin: style.lineJoin,
                            className: className,
                        },
                    }),
                },
            ],
        })

        if (layerId == null) {
            const arrowLayer = L.layerGroup([
                arrowBodyOutline,
                arrowHeadOutline,
                arrowBody,
                arrowHead,
            ])
            arrowLayer.start = start
            arrowLayer.end = end
            arrowLayer.feature = feature

            arrowLayer._isArrow = true
            arrowLayer._idx = index
            arrowLayer.toGeoJSON = function () {
                return feature
            }
            return arrowLayer
        } else {
            if (index == null) index = L_.layers.layer[layerId].length
            L_.Map_.rmNotNull(L_.layers.layer[layerId][index])
            L_.layers.layer[layerId][index] = L.layerGroup([
                arrowBodyOutline,
                arrowHeadOutline,
                arrowBody,
                arrowHead,
            ]).addTo(L_.Map_.map)
            L_.layers.layer[layerId][index]._isArrow = true
            L_.layers.layer[layerId][index]._idx = index
            L_.layers.layer[layerId][index].start = start
            L_.layers.layer[layerId][index].end = end
            L_.layers.layer[layerId][index].feature = feature
            if (typeof indexedCallback === 'function') indexedCallback()
        }
    },
    createAnnotation: function (
        feature,
        className,
        layerId,
        id1,
        id2,
        andAddToMap
    ) {
        if (id2 == null) id2 = 0

        className = className.replace(/ /g, '_')
        //Remove previous annotation if any
        $(`#${className}_${id1}_${id2}`)
            .parent()
            .parent()
            .parent()
            .parent()
            .remove()

        const featureStyle = feature.properties.style
        const styleString =
            (featureStyle.color != null
                ? 'text-shadow: ' +
                  F_.getTextShadowString(
                      featureStyle.color,
                      featureStyle.strokeOpacity,
                      featureStyle.weight
                  ) +
                  '; '
                : '') +
            (featureStyle.fillColor != null
                ? 'color: ' + featureStyle.fillColor + '; '
                : '') +
            (featureStyle.fontSize != null
                ? 'font-size: ' + featureStyle.fontSize + '; '
                : '') +
            (featureStyle.rotation != null
                ? 'transform: rotateZ(' +
                  parseInt(
                      !isNaN(featureStyle.rotation) ? featureStyle.rotation : 0
                  ) *
                      -1 +
                  'deg); '
                : '')

        const id = className + '_' + id1 + '_' + id2
        // prettier-ignore
        const popup = L.popup({
            className: `leaflet-popup-annotation`,
            closeButton: false,
            autoClose: false,
            closeOnEscapeKey: false,
            closeOnClick: false,
            autoPan: false,
            offset: new L.point(0, 3),
            interactive: true,
            bubblingMouseEvents: true
        })
            .setLatLng(
                new L.LatLng(
                    feature.geometry.coordinates[1],
                    feature.geometry.coordinates[0]
                )
            )
            .setContent(
                "<div>" +
                    `<div id='${id}'` +
                    ` class='${className === 'DrawToolAnnotation' ? 'drawToolAnnotation' : 'mmgisAnnotation'} ${className}_${id1} blackTextBorder'` +
                    " layer='" + id1 +
                    "' layerId='" + layerId + 
                    (L_.layers.layer[layerId] != null ? "' index='" + L_.layers.layer[layerId].length : '') +
                    "' style='" + styleString + "'>" +
                    `${feature.properties.name.replace(/[<>;{}]/g, '')}`,
                    '</div>' +
                '</div>'
            )

        if (popup?._contentNode?._leaflet_events)
            Object.keys(popup._contentNode._leaflet_events).forEach((ev) => {
                delete popup._contentNode._leaflet_events[ev]
            })

        popup._isAnnotation = true
        popup._annotationParams = {
            feature,
            className,
            layerId,
            id1,
            id2,
            andAddToMap,
        }
        popup.feature = feature
        popup.options = popup.options || {}
        popup.options.layerName = layerId
        popup.toGeoJSON = function () {
            return feature
        }

        if (andAddToMap) {
            popup.addTo(L_.Map_.map)
            L_.removePopupStopPropogationFunctions(popup)
            L_.layers.layer[layerId].push(popup)
        } else {
            setTimeout(() => {
                L_.removePopupStopPropogationFunctions(popup)
            }, 2000)
        }

        return popup
    },
    removePopupStopPropogationFunctions(popup) {
        if (popup?._contentNode?._leaflet_events)
            Object.keys(popup._contentNode._leaflet_events).forEach((ev) => {
                document
                    .querySelectorAll('.leaflet-popup-content')
                    .forEach(function (elm) {
                        // Now do something with my button
                        elm.removeEventListener(
                            'wheel',
                            popup._contentNode._leaflet_events[ev]
                        )
                    })
            })

        if (popup?._container?.children?.[0]?._leaflet_events)
            Object.keys(popup._container.children[0]._leaflet_events).forEach(
                (ev) => {
                    document
                        .querySelectorAll('.leaflet-popup-content-wrapper')
                        .forEach(function (elm) {
                            // Now do something with my button
                            elm.removeEventListener(
                                ev.replace(/\d+$/, ''),
                                popup._container.children[0]._leaflet_events[ev]
                            )
                        })
                }
            )
    },
    setLayerOpacity: function (name, newOpacity) {
        newOpacity = parseFloat(newOpacity)
        if (L_.Globe_) L_.Globe_.litho.setLayerOpacity(name, newOpacity)
        let mapLayer = L_.layers.layer[name]

        if (mapLayer) {
            if (mapLayer.options.initialFillOpacity == null)
                mapLayer.options.initialFillOpacity =
                    L_.layers.data[name]?.style?.fillOpacity != null
                        ? parseFloat(L_.layers.data[name].style.fillOpacity)
                        : 1
            try {
                mapLayer.setOpacity(newOpacity)
            } catch (error) {
                mapLayer.setStyle({
                    opacity: newOpacity,
                    fillOpacity:
                        newOpacity * mapLayer.options.initialFillOpacity,
                })
            }
            $(`.leafletMarkerShape_${F_.getSafeName(name)}`).css({
                opacity: newOpacity,
            })

            const sublayers = L_.layers.attachments[name]
            if (sublayers) {
                for (let sublayerName in sublayers) {
                    if (
                        sublayers[sublayerName] !== false &&
                        sublayers[sublayerName].layer != null &&
                        !['models'].includes(sublayerName)
                    ) {
                        try {
                            sublayers[sublayerName].layer.setOpacity(newOpacity)
                        } catch (error) {
                            try {
                                let opacity = newOpacity
                                let fillOpacity =
                                    newOpacity *
                                    mapLayer.options.initialFillOpacity
                                if (sublayerName === 'uncertainty_ellipses') {
                                    opacity = opacity * 0.8
                                    fillOpacity = fillOpacity * 0.25
                                }
                                sublayers[sublayerName].layer.setStyle({
                                    opacity,
                                    fillOpacity,
                                })
                            } catch (error2) {
                                /*
                                if (sublayers[sublayerName].layer._layers)
                                    for (let sl in sublayers[sublayerName].layer
                                        ._layers) {
                                    }
                                    */
                            }
                        }
                    }
                }
            }

            try {
                mapLayer.options.fillOpacity =
                    newOpacity * mapLayer.options.initialFillOpacity
                mapLayer.options.opacity = newOpacity
                mapLayer.options.style.fillOpacity =
                    newOpacity * mapLayer.options.initialFillOpacity
                mapLayer.options.style.opacity = newOpacity
            } catch (error) {
                mapLayer.options.fillOpacity =
                    newOpacity * mapLayer.options.initialFillOpacity
                mapLayer.options.opacity = newOpacity
            }
        }
        L_.layers.opacity[name] = newOpacity

        if (L_.activeFeature?.layer && L_.activeFeature.layerName === name) {
            L_.highlight(L_.activeFeature.layer)
        }
    },
    getLayerOpacity: function (name) {
        var mapLayer = L_.layers.layer[name]

        if (mapLayer == null) return 0

        var opacity
        try {
            opacity = mapLayer.options?.style.opacity
        } catch (error) {
            opacity = mapLayer.options?.opacity
        }
        return opacity
    },
    setLayerFilter: function (name, filter, value) {
        // Clear
        if (filter === 'clear') {
            L_.layers.filters[name] = {}
            if (L_.Globe_) {
                L_.Globe_.litho.setLayerFilterEffect(name, 'brightness', 1)
                L_.Globe_.litho.setLayerFilterEffect(name, 'contrast', 1)
                L_.Globe_.litho.setLayerFilterEffect(name, 'saturation', 1)
                L_.Globe_.litho.setLayerFilterEffect(name, 'blendCode', 0)
            }
        }
        // Create a filters object for the layer if one doesn't exist
        L_.layers.filters[name] = L_.layers.filters[name] || {}

        // Set the new filter (if it's not 'clear')
        if (filter !== 'clear') L_.layers.filters[name][filter] = value

        // Mappings because litho names things differently
        const lithoBlendMappings = ['none', 'overlay', 'color']
        const lithoFilterMappings = {
            brightness: 'brightness',
            contrast: 'contrast',
            saturate: 'saturation',
            saturation: 'saturation',
        }

        if (typeof L_.layers.layer[name].updateFilter === 'function') {
            let filterArray = []
            // Apply filter effects
            for (let f in L_.layers.filters[name]) {
                filterArray.push(f + ':' + L_.layers.filters[name][f])
                // For Globe/litho
                if (L_.Globe_) {
                    if (f === 'mix-blend-mode') {
                        L_.Globe_.litho.setLayerFilterEffect(
                            name,
                            'blendCode',
                            lithoBlendMappings.indexOf(
                                L_.layers.filters[name][f]
                            )
                        )
                    } else {
                        L_.Globe_.litho.setLayerFilterEffect(
                            name,
                            lithoFilterMappings[f],
                            parseFloat(L_.layers.filters[name][f])
                        )
                    }
                }
            }
            // For Map
            L_.layers.layer[name].updateFilter(filterArray)
        }
    },
    resetLayerFills: function (onlyThisLayerName) {
        // Regular Layers
        for (let key in L_.layers.layer) {
            const layerNameParts = key.split('_')
            const onId =
                layerNameParts[1] != 'master'
                    ? parseInt(layerNameParts[1])
                    : layerNameParts[1]

            if (onlyThisLayerName != null && onlyThisLayerName !== key) continue

            if (
                (L_.layers.layer[key] &&
                    L_.layers.data[key] &&
                    (L_.layers.data[key].type === 'point' ||
                        (key.toLowerCase().indexOf('draw') === -1 &&
                            (L_.layers.data[key].type === 'vector' ||
                                L_.layers.data[key].type === 'query')))) ||
                (layerNameParts[0] === 'DrawTool' && !Number.isNaN(onId))
            ) {
                if (
                    L_.layers.layer.hasOwnProperty(key) &&
                    L_.layers.layer[key] != undefined &&
                    L_.layers.data.hasOwnProperty(key) &&
                    L_.layers.data[key].style != undefined
                ) {
                    L_.layers.layer[key].eachLayer((layer) => {
                        const savedOptions = layer.options
                        const savedUseKeyAsName = layer.useKeyAsName

                        let fillColor = L_.layers.data[key].style.fillColor
                        let color = L_.layers.data[key].style.color
                        let opacity = layer.options.opacity
                        let fillOpacity = layer.options.fillOpacity
                        let weight = layer.options.weight

                        if (layer._isAnnotation) {
                            // Annotation
                            if (layer._container)
                                $(layer._container)
                                    .find('.mmgisAnnotation')
                                    .css(
                                        'color',
                                        layer.feature?.properties?.style
                                            ?.fillColor ||
                                            layer.options?.fillColor ||
                                            fillColor ||
                                            'white'
                                    )
                        } else if (layer._isArrow) {
                            // Arrow
                            $(
                                `.LayerArrow_${layer._idx}.mmgisArrowOutline`
                            ).css('stroke', '')
                        } else {
                            L_.layers.layer[key].resetStyle(layer)
                        }

                        try {
                            layer.setStyle({
                                opacity: opacity,
                                fillOpacity: fillOpacity,
                                fillColor: layer.options.fillColor || fillColor,
                                weight: parseInt(weight),
                                color: layer.options.color || color,
                                stroke: layer.options.color || color,
                            })
                        } catch (err) {
                            if (layer._icon) layer._icon.style.filter = ''
                        }
                        layer.options = savedOptions
                        layer.useKeyAsName = savedUseKeyAsName
                    })
                } else if (layerNameParts[0] === 'DrawTool') {
                    for (let k in L_.layers.layer[key]) {
                        if (!L_.layers.layer[key][k]) continue
                        if ('getLayers' in L_.layers.layer[key][k]) {
                            let layer = L_.layers.layer[key][k]
                            if (!layer?.feature?.properties?.arrow) {
                                // Polygons and lines
                                layer.eachLayer(function (l) {
                                    setLayerStyle(l)
                                })
                            } else {
                                // Arrow
                                let layers = L_.layers.layer[key][k]._layers
                                const style =
                                    L_.layers.layer[key][k].feature.properties
                                        .style
                                const color = style.color
                                layers[Object.keys(layers)[0]].setStyle({
                                    color,
                                })
                                layers[Object.keys(layers)[1]].setStyle({
                                    color,
                                })
                            }
                        } else if (
                            L_.layers.layer[key][k].feature?.properties
                                ?.annotation
                        ) {
                            // Annotation
                            let layer = L_.layers.layer[key][k]
                            let id =
                                '#DrawToolAnnotation_' +
                                layer.feature.properties._.file_id +
                                '_' +
                                layer.feature.properties._.id
                            $(id).css(
                                'color',
                                layer.feature.properties.style.fillColor
                            )
                        } else if ('feature' in L_.layers.layer[key][k]) {
                            // Points (that are not annotations)
                            let layer = L_.layers.layer[key][k]
                            setLayerStyle(layer)
                        }
                    }

                    function setLayerStyle(layer) {
                        const style = layer.feature.properties.style

                        const geoColor = F_.getIn(style, 'geologic.color', null)
                        const color =
                            geoColor != null
                                ? F_.colorCodeToColor(geoColor)
                                : style.color

                        if (typeof layer.setStyle === 'function')
                            layer.setStyle({
                                color: color,
                                stroke: color,
                            })
                        else if (layer._icon?.style) {
                            layer._icon.style.filter = 'unset'
                        }
                    }
                }
            }
        }

        // Sublayers
        // Currently only coordinate_markers
        // Expects feature._style to be set
        const highlightableSublayers = ['coordinate_markers']
        for (let layerName in L_.layers.attachments) {
            if (L_.layers.attachments[layerName]) {
                for (let sublayerName in L_.layers.attachments[layerName]) {
                    if (
                        L_.layers.attachments[layerName][sublayerName] &&
                        highlightableSublayers.includes(sublayerName)
                    ) {
                        for (let sll in L_.layers.attachments[layerName][
                            sublayerName
                        ].layer._layers) {
                            try {
                                L_.layers.attachments[layerName][
                                    sublayerName
                                ].layer._layers[sll].setStyle(
                                    L_.layers.attachments[layerName][
                                        sublayerName
                                    ].layer._layers[sll].feature._style
                                )
                            } catch (err) {}
                        }
                    }
                }
            }
        }
    },
    home() {
        L_.Map_.resetView(L_.configData.msv.view)
        L_.Globe_.litho.setCenter(L_.configData.msv.view)
    },
    hasTool: function (toolName) {
        for (var i = 0; i < L_.tools.length; i++) {
            if (
                L_.tools[i].hasOwnProperty('name') &&
                L_.tools[i].name.toLowerCase() == toolName
            )
                return true
        }
        return false
    },
    getToolVars: function (toolName, withVarsFromLayers, showWarnings) {
        let vars = {}
        for (var i = 0; i < L_.tools.length; i++) {
            if (
                L_.tools[i].hasOwnProperty('name') &&
                L_.tools[i].name.toLowerCase() == toolName &&
                L_.tools[i].hasOwnProperty('variables')
            ) {
                vars = L_.tools[i].variables
            }
        }
        if (withVarsFromLayers) {
            vars.__layers = {}
            L_.layers.dataFlat.forEach((layerConfig) => {
                if (
                    layerConfig.name != null &&
                    layerConfig?.variables?.tools?.[toolName] != null
                ) {
                    vars.__layers[layerConfig.name] =
                        layerConfig.variables.tools[toolName]
                }
            })
        }
        if (Object.keys(vars).length > 0) return vars
        if (showWarnings)
            console.warn(
                `WARNING: Tried to get ${toolName} Tool's config variables and failed.`
            )
        return { __noVars: true }
    },
    /**
     * @param {object} layer - leaflet layer object
     */
    setLastActiveFeature: function (layer) {
        let layerName, lat, lon, key, value
        if (layer) {
            layerName = layer.hasOwnProperty('options')
                ? layer.options.layerName
                : null
            lat = layer.hasOwnProperty('_latlng') ? layer._latlng.lat : null
            lon = layer.hasOwnProperty('_latlng') ? layer._latlng.lng : null

            if (L_.layers.data[layerName]?.variables?.useKeyAsId) {
                key = L_.layers.data[layerName].variables.useKeyAsId

                value = F_.getIn(layer.feature.properties, key)
            }
        }

        if (layerName != null && key != null && value != null) {
            L_.lastActiveFeature = {
                layerName: layerName,
                lat: null,
                lon: null,
                key: key,
                value: value,
            }
        } else if (layerName != null && lat != null && lon != null) {
            L_.lastActiveFeature = {
                layerName: layerName,
                lat: lat,
                lon: lon,
                key: null,
                value: null,
            }
        }
    },
    // relation and field are optional
    // relation is null, -1, or 1
    // if relation is 1 it'll select the next feature, -1 the previous
    // if field is null, relation is relative to initial geojson order
    // otherwise sort by field first
    selectFeature(layerName, feature, relation, field) {
        // Helper function to round coordinates to match GEOJSON_PRECISION
        const roundCoordinates = (coords, precision) => {
            if (typeof coords[0] === 'number') {
                // Single coordinate pair [lng, lat]
                return coords.map((c) => parseFloat(c.toFixed(precision)))
            } else {
                // Nested array of coordinates
                return coords.map((c) => roundCoordinates(c, precision))
            }
        }

        const roundGeometry = (geometry) => {
            if (!geometry || !geometry.coordinates) return geometry
            const rounded = JSON.parse(JSON.stringify(geometry))
            rounded.coordinates = roundCoordinates(
                rounded.coordinates,
                L_.GEOJSON_PRECISION
            )
            return rounded
        }

        let f = JSON.parse(JSON.stringify(feature))
        layerName = L_.asLayerUUID(layerName)
        const layer = L_.layers.layer[layerName]

        // If relation is a feature, override feature
        if (typeof relation === 'object' && relation.type != null) {
            f = relation
            relation = 0
        }

        if (layer) {
            const layers = layer._layers
            const layerKeys = Object.keys(layers)

            const featureWithout_ = JSON.parse(JSON.stringify(f))
            if (featureWithout_.properties?._ != null)
                delete featureWithout_.properties._
            if (featureWithout_.properties?._dataset != null)
                delete featureWithout_.properties._dataset
            if (featureWithout_.properties?._geodataset != null)
                delete featureWithout_.properties._geodataset
            if (featureWithout_.properties?.feature_id != null)
                delete featureWithout_.properties.feature_id

            for (let i = 0; i < layerKeys.length; i++) {
                const l = layerKeys[i]
                const lfeatureWithout_ = JSON.parse(
                    JSON.stringify(layers[l].feature)
                )
                if (lfeatureWithout_.properties?._ != null)
                    delete lfeatureWithout_.properties._
                if (lfeatureWithout_.properties?._dataset != null)
                    delete lfeatureWithout_.properties._dataset
                if (lfeatureWithout_.properties?._geodataset != null)
                    delete lfeatureWithout_.properties._geodataset
                if (lfeatureWithout_.properties?.feature_id != null)
                    delete lfeatureWithout_.properties.feature_id

                // Round both geometries to GEOJSON_PRECISION before comparing
                // This accounts for precision differences between Cesium (which receives
                // precision-reduced GeoJSON) and Leaflet (which has full precision)
                const roundedClickedGeometry = roundGeometry(f.geometry)
                const roundedLayerGeometry = roundGeometry(
                    layers[l].feature.geometry
                )

                const geometryMatch = F_.isEqual(
                    roundedLayerGeometry,
                    roundedClickedGeometry,
                    true
                )
                const propertiesMatch = F_.isEqual(
                    lfeatureWithout_.properties,
                    featureWithout_.properties,
                    true
                )

                if (geometryMatch && propertiesMatch) {
                    if (layers[layerKeys[i + (relation || 0)]] != null) {
                        // Set flag to prevent Globe click handler from firing
                        if (
                            L_.Globe_ &&
                            L_.Globe_.litho &&
                            L_.Globe_.litho._justSelectedFromMap !== undefined
                        ) {
                            L_.Globe_.litho._justSelectedFromMap = true
                            // Clear flag after short delay
                            if (L_.Globe_.litho._justSelectedTimeout) {
                                clearTimeout(
                                    L_.Globe_.litho._justSelectedTimeout
                                )
                            }
                            L_.Globe_.litho._justSelectedTimeout = setTimeout(
                                () => {
                                    L_.Globe_.litho._justSelectedFromMap = false
                                },
                                500
                            )
                        }

                        // Highlight the feature in Globe
                        if (L_.Globe_ && L_.Globe_.highlight) {
                            L_.Globe_.highlight(layerName, f)
                        }
                        layers[layerKeys[i + (relation || 0)]].fireEvent(
                            'click'
                        )
                    }
                    return
                }
            }
        }
    },
    // Returns any array of all the "fromProp"-like configuration fields for a layer
    getDynamicProps(layerConfig) {
        let dynamicProps = []
        if (layerConfig?.style) {
            Object.keys(layerConfig.style).forEach((key) => {
                if (key.endsWith('Prop'))
                    dynamicProps.push(layerConfig.style[key])
            })
        }
        if (layerConfig?.variables?.useKeyAsName) {
            dynamicProps = dynamicProps.concat(
                typeof layerConfig.variables.useKeyAsName === 'string'
                    ? [layerConfig.variables.useKeyAsName]
                    : layerConfig.variables.useKeyAsName
            )
        }
        return dynamicProps
    },
    /**
     * Converts lnglat geojsons into the primary coordinate type.
     * @param {object} geojson - geojson object or geojson feature
     */
    convertGeoJSONLngLatsToPrimaryCoordinates(geojson, forceType) {
        if (geojson.features) {
            const nextGeoJSON = JSON.parse(JSON.stringify(geojson))
            const convertedFeatures = []
            nextGeoJSON.features.forEach((feature) => {
                const f = JSON.parse(JSON.stringify(feature))
                F_.coordinateDepthTraversal(
                    f.geometry.coordinates,
                    (coords) => {
                        let converted = []
                        const elev = coords[2]
                        converted = L_.Coordinates.convertLngLat(
                            coords[0],
                            coords[1],
                            forceType
                        )
                        if (elev != null) converted[2] = elev
                        return converted
                    }
                )
                convertedFeatures.push(f)
            })
            nextGeoJSON.features = convertedFeatures
            nextGeoJSON._coordinates =
                L_.Coordinates.states[L_.Coordinates.mainType]
            nextGeoJSON._coordinates.type = L_.Coordinates.mainType

            return nextGeoJSON
        } else {
            // Just a single feature
            const feature = JSON.parse(JSON.stringify(geojson))
            F_.coordinateDepthTraversal(
                feature.geometry.coordinates,
                (coords) => {
                    let converted = []
                    const elev = coords[2]
                    converted = L_.Coordinates.convertLngLat(
                        coords[0],
                        coords[1],
                        forceType
                    )
                    if (elev != null) converted[2] = elev
                    return converted
                }
            )
            return feature
        }
    },
    asLayerUUID(uuid) {
        if (L_.layers.data[uuid] != null) return uuid
        if (L_.layers.nameToUUID[uuid]?.[0] != null)
            return L_.layers.nameToUUID[uuid][0]
        return null
    },
    /**
     * @param {object} - activePoint { layerUUID: , lat: lon: }
     * @returns {bool} - true only if successful
     */
    selectPoint(activePoint) {
        if (activePoint == null) return false
        // Backward pre-uuid compatibility
        activePoint.layerUUID = L_.asLayerUUID(
            activePoint.layerUUID || activePoint.layerName
        )

        if (
            activePoint.layerUUID != null &&
            activePoint.lat != null &&
            activePoint.lon != null
        ) {
            if (L_.layers.layer.hasOwnProperty(activePoint.layerUUID)) {
                let featureLayers =
                    L_.layers.layer[activePoint.layerUUID]._layers
                for (let featureLayerId in featureLayers) {
                    if (
                        featureLayers[featureLayerId]?.feature?.geometry
                            ?.type &&
                        featureLayers[
                            featureLayerId
                        ].feature.geometry.type.toLowerCase() === 'point' &&
                        featureLayers[featureLayerId]._latlng.lat ==
                            activePoint.lat &&
                        featureLayers[featureLayerId]._latlng.lng ==
                            activePoint.lon
                    ) {
                        featureLayers[featureLayerId].fireEvent('click')
                        L_._selectPointViewHelper(
                            activePoint,
                            featureLayers[featureLayerId]
                        )
                        return true
                    }
                }
            }
        } else if (
            activePoint.layerUUID != null &&
            activePoint.key != null &&
            activePoint.value != null
        ) {
            if (L_.layers.layer.hasOwnProperty(activePoint.layerUUID)) {
                let featureLayers =
                    L_.layers.layer[activePoint.layerUUID]._layers
                for (let featureLayerId in featureLayers) {
                    if (
                        featureLayers[featureLayerId] &&
                        featureLayers[featureLayerId].feature &&
                        featureLayers[featureLayerId].feature.properties
                    ) {
                        if (
                            F_.getIn(
                                featureLayers[featureLayerId].feature
                                    .properties,
                                activePoint.key.split('.')
                            ) == activePoint.value
                        ) {
                            featureLayers[featureLayerId].fireEvent('click')
                            L_._selectPointViewHelper(
                                activePoint,
                                featureLayers[featureLayerId]
                            )
                            return true
                        }
                    }
                }
            }
        } else if (
            activePoint.layerUUID != null &&
            activePoint.layerId != null
        ) {
            if (L_.layers.layer.hasOwnProperty(activePoint.layerUUID)) {
                let featureLayers =
                    L_.layers.layer[activePoint.layerUUID]._layers
                const featureLayerId = activePoint.layerId
                if (featureLayers[featureLayerId] != null) {
                    featureLayers[featureLayerId].fireEvent('click')
                    L_._selectPointViewHelper(
                        activePoint,
                        featureLayers[featureLayerId]
                    )
                    return true
                }
            }
        }
        return false
    },
    _selectPointViewHelper: function (activePoint, layer) {
        if (activePoint.view === 'go') {
            let newView = []
            if (layer._latlng) {
                newView = [
                    layer._latlng.lat,
                    layer._latlng.lng,
                    activePoint.zoom ||
                        L_.Map_.mapScaleZoom ||
                        L_.Map_.map.getZoom(),
                ]
            } else if (layer._latlngs) {
                let lat = 0,
                    lng = 0
                let llflat = layer._latlngs.flat(Infinity)
                for (let ll of llflat) {
                    lat += ll.lat
                    lng += ll.lng
                }
                newView = [
                    lat / llflat.length,
                    lng / llflat.length,
                    parseInt(
                        activePoint.zoom ||
                            L_.Map_.mapScaleZoom ||
                            L_.Map_.map.getZoom()
                    ),
                ]
            }
            setTimeout(() => {
                L_.Map_.resetView(newView)
            }, 50)
            if (L_.hasGlobe) {
                L_.Globe_.litho.setCenter(newView)
            }
        }
        setTimeout(() => {
            L_.setActiveFeature(layer)
        }, 300)
    },
    reorderLayers: function (newLayersOrdered) {
        // Check that newLayersOrdered is valid
        let isValid = true
        if (newLayersOrdered.length === L_._layersOrdered.length) {
            L_._layersOrdered.forEach((l) => {
                if (!newLayersOrdered.includes(l)) isValid = false
            })
        } else isValid = false

        if (!isValid) {
            console.warn(
                "reorderLayers: newLayersOrdered is not consistent, won't run."
            )
            return
        }

        L_._layersOrdered = newLayersOrdered

        if (L_.Map_) L_.Map_.orderedBringToFront(true)

        if (L_.Globe_) L_.Globe_.litho.orderLayers(L_._layersOrdered)
    },
    clearVectorLayer: function (layerName) {
        layerName = L_.asLayerUUID(layerName)
        try {
            L_.clearGeoJSONData(L_.layers.layer[layerName])
            L_.clearVectorLayerInfo()
            L_.syncSublayerData(layerName)
        } catch (e) {
            console.log(e)
            console.warn('Warning: Unable to clear vector layer: ' + layerName)
        }
    },
    removeLayerHelper: function (updateLayer, removedLayers, layersGeoJSON) {
        // If we remove a layer but its properties are displayed in the InfoTool
        // and description (i.e. it was clicked), clear the InfoTool and description
        const infoTool = ToolController_.getTool('InfoTool')
        removedLayers.forEach((removedLayer) => {
            if (infoTool.currentLayer === removedLayer) {
                L_.clearVectorLayerInfo()
            }

            // Remove the layer
            updateLayer.removeLayer(removedLayer)
        })

        L_.clearGeoJSONData(updateLayer)
        L_.syncSublayerData(updateLayer._layerName)
        L_.addGeoJSONData(updateLayer, layersGeoJSON)
    },
    trimVectorLayerKeepBeforeTime: function (
        layerName,
        keepBeforeTime,
        timePropPath
    ) {
        L_.trimVectorLayerHelper(
            layerName,
            keepBeforeTime,
            timePropPath,
            'before'
        )
    },
    trimVectorLayerKeepAfterTime: function (
        layerName,
        keepAfterTime,
        timePropPath
    ) {
        L_.trimVectorLayerHelper(
            layerName,
            keepAfterTime,
            timePropPath,
            'after'
        )
    },
    trimVectorLayerHelper: function (
        layerName,
        keepTime,
        timePropPath,
        trimType
    ) {
        layerName = L_.asLayerUUID(layerName)
        // Validate input parameters
        if (!keepTime) {
            console.warn(
                'Warning: The input for keep' +
                    trimType.capitalizeFirstLetter() +
                    'Time is invalid: ' +
                    keepTime
            )
            return
        }

        if (!timePropPath) {
            console.warn(
                'Warning: The input for timePropPath is invalid: ' +
                    timePropPath
            )
            return
        }

        if (keepTime) {
            const keepAfterAsDate = new Date(keepTime)
            if (isNaN(keepAfterAsDate.getTime())) {
                console.warn(
                    'Warning: The input for keep' +
                        trimType.capitalizeFirstLetter() +
                        'Time is invalid: ' +
                        keepTime
                )
                return
            }
        }

        if (layerName in L_.layers.layer) {
            const updateLayer = L_.layers.layer[layerName]

            if (keepTime) {
                const layersGeoJSON = updateLayer.toGeoJSON(
                    L_.GEOJSON_PRECISION
                )
                const removedLayers = []

                const keepTimeAsDate = new Date(keepTime)

                var layers = updateLayer.getLayers()
                for (let i = layers.length - 1; i >= 0; i--) {
                    let layer = layers[i]
                    if (layer.feature.properties[timePropPath]) {
                        const layerDate = new Date(
                            layer.feature.properties[timePropPath]
                        )
                        if (isNaN(layerDate.getTime())) {
                            console.warn(
                                'Warning: The time for the layer is invalid: ' +
                                    layer.feature.properties[timePropPath]
                            )
                            continue
                        }
                        if (trimType === 'after') {
                            if (layerDate < keepTimeAsDate) {
                                removedLayers.push(layer)
                                layersGeoJSON.features.splice(i, 1)
                            }
                        } else if (trimType === 'before') {
                            if (layerDate > keepTimeAsDate) {
                                removedLayers.push(layer)
                                layersGeoJSON.features.splice(i, 1)
                            }
                        }
                    }
                }

                L_.removeLayerHelper(updateLayer, removedLayers, layersGeoJSON)
                L_.syncSublayerData(layerName)
            }
        } else {
            console.warn(
                'Warning: Unable to trim vector layer as it does not exist: ' +
                    layerName
            )
        }
    },
    keepFirstN: function (layerName, keepFirstN) {
        L_.keepNHelper(layerName, keepFirstN, 'first')
    },
    keepLastN: function (layerName, keepLastN) {
        L_.keepNHelper(layerName, keepLastN, 'last')
    },
    keepNHelper: function (layerName, keepN, keepType) {
        layerName = L_.asLayerUUID(layerName)
        // Validate input parameter
        const keepNum = parseInt(keepN)
        if (Number.isNaN(Number(keepNum))) {
            console.warn(
                'Warning: Unable to trim vector layer `' +
                    layerName +
                    '` as keep' +
                    keepType.capitalizeFirstLetter() +
                    'N == ' +
                    keepN +
                    ' and is not a valid integer'
            )
            return
        }

        if (layerName in L_.layers.layer) {
            // Keep N elements if greater than 0 else keep all elements
            if (keepN && keepN > 0) {
                const updateLayer = L_.layers.layer[layerName]
                var layers = updateLayer.getLayers()

                const layersGeoJSON = updateLayer.toGeoJSON(
                    L_.GEOJSON_PRECISION
                )

                const removedLayers = []
                if (keepType === 'last') {
                    keepN = Math.min(keepN, layersGeoJSON.features.length)

                    for (
                        let i = 0;
                        i < layersGeoJSON.features.length - keepN;
                        i++
                    )
                        removedLayers.push(layers[i])

                    layersGeoJSON.features.splice(
                        0,
                        layersGeoJSON.features.length - keepN
                    )
                    L_.removeLayerHelper(
                        updateLayer,
                        removedLayers,
                        layersGeoJSON
                    )
                } else if (keepType === 'first') {
                    keepN = Math.min(keepN, layersGeoJSON.features.length)

                    for (
                        let i = layersGeoJSON.features.length - 1;
                        i >= keepN;
                        i--
                    )
                        removedLayers.push(layers[i])

                    layersGeoJSON.features = layersGeoJSON.features.slice(
                        0,
                        keepN
                    )
                    L_.removeLayerHelper(
                        updateLayer,
                        removedLayers,
                        layersGeoJSON
                    )
                }
            }
        } else {
            console.warn(
                'Warning: Unable to trim vector layer as it does not exist: ' +
                    layerName
            )
        }
    },
    trimLineString: function (layerName, time, timeProp, trimN, startOrEnd) {
        layerName = L_.asLayerUUID(layerName)

        // Validate input parameters
        if (!time) {
            console.warn(
                'Warning: Unable to trim the LineString in vector layer `' +
                    layerName +
                    '` as time === ' +
                    time +
                    ' and is invalid'
            )
            return
        }

        const timeAsDate = new Date(time)
        if (isNaN(timeAsDate.getTime())) {
            console.warn('Warning: The input for time is not a valid date')
            return
        }

        if (!timeProp) {
            console.warn(
                'Warning: Unable to trim the LineString in vector layer `' +
                    layerName +
                    '` as timeProp === ' +
                    timeProp +
                    ' and is invalid'
            )
            return
        }

        const trimNum = parseInt(trimN)
        if (Number.isNaN(Number(trimNum))) {
            console.warn(
                'Warning: Unable to trim the LineString in vector layer `' +
                    layerName +
                    '` as trimN == ' +
                    trimN +
                    ' and is not a valid integer'
            )
            return
        }

        const TRIM_DIRECTION = ['start', 'end']
        if (!TRIM_DIRECTION.includes(startOrEnd)) {
            console.warn(
                'Warning: Unable to trim the LineString in vector layer `' +
                    layerName +
                    '` as startOrEnd == ' +
                    startOrEnd +
                    ' and is not a valid input value'
            )
            return
        }

        if (!time) {
            console.warn(
                'Warning: Unable to trim the LineString in vector layer `' +
                    layerName +
                    '` as startOrEnd == ' +
                    startOrEnd +
                    ' and is not a valid input value'
            )
            return
        }

        if (layerName in L_.layers.layer) {
            const updateLayer = L_.layers.layer[layerName]

            var layersGeoJSON = updateLayer.toGeoJSON(L_.GEOJSON_PRECISION)
            var features = layersGeoJSON.features

            // All of the features have to be a LineString
            const findNonLineString = features.filter((feature) => {
                return feature.geometry.type !== 'LineString'
            })

            if (findNonLineString.length > 0) {
                console.warn(
                    'Warning: Unable to trim the vector layer `' +
                        layerName +
                        '` as the features contain geometry that is not LineString'
                )
                return
            }

            if (features.length > 0) {
                // Original layer time
                var layerTime
                if (startOrEnd === 'start') {
                    layerTime = features[0].properties[timeProp]
                } else {
                    layerTime =
                        features[features.length - 1].properties[timeProp]
                }
                const layerTimeAsDate = new Date(layerTime)

                // Trim only if the new start time is after the layer start time
                if (
                    startOrEnd === 'start' &&
                    layerTimeAsDate < timeAsDate &&
                    trimNum > 0
                ) {
                    let leftToTrim = trimNum
                    let updatedFeatures = []
                    // Walk forwards to find the new time
                    while (features.length > 0) {
                        const feature = features[0]
                        // If the feature is missing the key for the time
                        if (!feature.properties.hasOwnProperty(timeProp)) {
                            console.warn(
                                'Warning: Unable to trim the vector layer `' +
                                    layerName +
                                    "` as the the feature's properties object is missing the `" +
                                    timeProp +
                                    '` key'
                            )
                            return
                        }

                        // If the number to trim is greater than the number of vertices in the current feature,
                        // trim the entire feature and move on to the next feature
                        if (leftToTrim >= feature.geometry.coordinates.length) {
                            leftToTrim -= feature.geometry.coordinates.length
                            features.shift()
                            continue
                        }

                        // Trim
                        if (leftToTrim > 0) {
                            feature.geometry.coordinates =
                                feature.geometry.coordinates.slice(leftToTrim)
                            leftToTrim -= trimNum
                        }

                        if (leftToTrim <= 0) {
                            feature.properties[timeProp] = time
                        }

                        updatedFeatures.push(feature)
                        features.shift()
                    }
                    layersGeoJSON.features = updatedFeatures
                }

                // Trim only if the new end time is before the layer end time
                if (
                    startOrEnd === 'end' &&
                    layerTimeAsDate > timeAsDate &&
                    trimNum > 0
                ) {
                    let leftToTrim = trimNum
                    let updatedFeatures = []
                    // Walk backwards to find the new time
                    while (features.length > 0) {
                        const feature = features[features.length - 1]
                        // If the feature is missing the key for the end time
                        if (!feature.properties.hasOwnProperty(timeProp)) {
                            console.warn(
                                'Warning: Unable to trim the vector layer `' +
                                    layerName +
                                    "` as the the feature's properties object is missing the key `" +
                                    timeProp +
                                    '` for the end time'
                            )
                            return
                        }

                        // If the number to trim is greater than the number of vertices in the current feature,
                        // trim the entire feature and move on to the next feature
                        if (leftToTrim >= feature.geometry.coordinates.length) {
                            leftToTrim -= feature.geometry.coordinates.length
                            features.pop()
                            continue
                        }

                        // Trim
                        if (leftToTrim > 0) {
                            const length = feature.geometry.coordinates.length
                            feature.geometry.coordinates =
                                feature.geometry.coordinates.slice(
                                    0,
                                    length - leftToTrim
                                )
                            leftToTrim -= trimNum
                        }

                        if (leftToTrim <= 0) {
                            feature.properties[timeProp] = time
                        }

                        updatedFeatures.unshift(feature)
                        features.pop()
                    }
                    layersGeoJSON.features = updatedFeatures
                }

                L_.clearVectorLayerInfo()
                L_.clearGeoJSONData(updateLayer)
                L_.addGeoJSONData(updateLayer, layersGeoJSON)
            } else {
                console.warn(
                    'Warning: Unable to trim the vector layer `' +
                        layerName +
                        '` as the layer contains no features'
                )
                return
            }
        } else {
            console.warn(
                'Warning: Unable to trim vector layer as it does not exist: ' +
                    layerName
            )
        }
    },
    appendLineString: function (layerName, inputData, timeProp) {
        layerName = L_.asLayerUUID(layerName)

        // Validate input parameter
        if (!inputData) {
            console.warn(
                'Warning: Unable to append to vector layer `' +
                    layerName +
                    '` as inputData is invalid: ' +
                    JSON.stringify(inputData, null, 4)
            )
            return false
        }

        // Make sure the timeProp exists as a property in the updated data
        if (!inputData.properties.hasOwnProperty(timeProp)) {
            console.warn(
                'Warning: Unable to append to the vector layer `' +
                    layerName +
                    '` as timeProp === ' +
                    timeProp +
                    ' and does not exist as a property in inputData: ' +
                    JSON.stringify(lastFeature, null, 4)
            )
            return false
        }

        if (layerName in L_.layers.layer) {
            const updateLayer = L_.layers.layer[layerName]
            if (L_._layersBeingMade[layerName] === true) {
                console.error(
                    `ERROR - appendLineString: Cannot make layer ${layerObj.display_name}/${layerObj.name} as it's already being made!`
                )
                return false
            }

            var layers = updateLayer.getLayers()
            var layersGeoJSON = updateLayer.toGeoJSON(L_.GEOJSON_PRECISION)
            var features = layersGeoJSON.features

            if (features.length > 0) {
                var lastFeature = features[features.length - 1]
                // Make sure the last feature is a LineString
                if (lastFeature.geometry.type !== 'LineString') {
                    console.warn(
                        'Warning: Unable to append to the vector layer `' +
                            layerName +
                            '` as the feature is not a LineStringfeature: ' +
                            JSON.stringify(lastFeature, null, 4)
                    )
                    return false
                }

                // Make sure the timeProp exists as a property in the feature
                if (!lastFeature.properties.hasOwnProperty(timeProp)) {
                    console.warn(
                        'Warning: Unable to append to the vector layer `' +
                            layerName +
                            '` as timeProp === ' +
                            timeProp +
                            ' and does not exist as a property in the feature: ' +
                            JSON.stringify(lastFeature, null, 4)
                    )
                    return
                }

                if (inputData.type === 'Feature') {
                    if (inputData.geometry.type !== 'LineString') {
                        console.warn(
                            'Warning: Unable to append to vector layer `' +
                                layerName +
                                "` as inputData has the wrong geometry type (must be of type 'LineString'): " +
                                JSON.stringify(inputData, null, 4)
                        )
                        return false
                    }

                    // Append new data to the end of the last feature
                    lastFeature.geometry.coordinates =
                        lastFeature.geometry.coordinates.concat(
                            inputData.geometry.coordinates
                        )

                    // Update the time
                    lastFeature.properties[timeProp] =
                        inputData.properties[timeProp]
                } else {
                    console.warn(
                        'Warning: Unable to append to vector layer `' +
                            layerName +
                            "` as inputData has the wrong type (must be of type 'Feature'): " +
                            JSON.stringify(inputData, null, 4)
                    )
                    return false
                }

                const initialOn = L_.layers.on[layerName]
                if (initialOn) {
                    L_.toggleLayerHelper(L_.layers.data[layerName], false)
                    L_.layers.on[layerName] = true
                }

                L_.clearGeoJSONData(updateLayer)
                try {
                    L_.addGeoJSONData(updateLayer, layersGeoJSON)
                } catch (e) {
                    console.log(e)
                    console.warn(
                        'Warning: Unable to append LineString to layer as the layer or input data is invalid: ' +
                            layerName
                    )
                    return false
                }

                if (initialOn) {
                    // Reselect activeFeature
                    if (L_.activeFeature) {
                        L_.selectFeature(
                            L_.activeFeature.layerName,
                            L_.activeFeature.feature
                        )
                    }
                }
            } else {
                console.warn(
                    'Warning: Unable to append to the vector layer `' +
                        layerName +
                        '` as the layer contains no features'
                )
                return false
            }
        } else {
            console.warn(
                'Warning: Unable to append to vector layer as it does not exist: ' +
                    layerName
            )
            return false
        }
        return true
    },
    updateVectorLayer: function (layerName, inputData, keepLastN, stopLoops) {
        layerName = L_.asLayerUUID(layerName)

        if (layerName in L_.layers.layer) {
            const layerConfig = L_.layers.data[layerName]
            if (L_._layersBeingMade[layerName] === true) {
                console.warn(
                    `WARNING - updateVectorLayer: Cannot make layer ${layerConfig.display_name}/${layerConfig.name} as it's already being made!`
                )
                return false
            }

            const updateLayer = L_.layers.layer[layerName]

            try {
                L_.addGeoJSONData(updateLayer, inputData, keepLastN, stopLoops)
            } catch (e) {
                console.log(e)
                console.warn(
                    'Warning: Unable to update vector layer as the layer or input data is invalid: ' +
                        layerName
                )
                return false
            }
            L_.syncSublayerData(layerName)
            L_.globeLithoLayerHelper(L_.layers.layer[layerName])
            L_.setLayerOpacity(layerName, L_.layers.opacity[layerName])
        } else {
            console.warn(
                'Warning: Unable to update vector layer as it does not exist: ' +
                    layerName
            )
            return false
        }
        return true
    },
    // Make a layer's sublayer match the layers data again
    syncSublayerData: async function (layerName, onlyClear) {
        layerName = L_.asLayerUUID(layerName)

        if (
            L_.layers.layer[layerName] == null ||
            L_.layers.layer[layerName] == false
        )
            return

        try {
            let geojson = L_.layers.layer[layerName].toGeoJSON(
                L_.GEOJSON_PRECISION
            )
            if (L_.layers.layer[layerName]._sourceGeoJSON)
                geojson = L_.layers.layer[layerName]._sourceGeoJSON

            // Now try the sublayers (if any)
            const subUpdateLayers = L_.layers.attachments[layerName]

            if (subUpdateLayers) {
                for (let sublayerName in subUpdateLayers) {
                    if (
                        subUpdateLayers[sublayerName] !== false &&
                        subUpdateLayers[sublayerName].layer != null
                    ) {
                        subUpdateLayers[sublayerName].layer.clearLayers()
                        if (
                            typeof subUpdateLayers[sublayerName].layer
                                .customClearLayers === 'function'
                        ) {
                            subUpdateLayers[
                                sublayerName
                            ].layer.customClearLayers(layerName, sublayerName)
                        }

                        if (!onlyClear) {
                            if (
                                typeof subUpdateLayers[sublayerName].layer
                                    .addDataEnhanced === 'function'
                            ) {
                                subUpdateLayers[
                                    sublayerName
                                ].layer.addDataEnhanced(
                                    geojson,
                                    layerName,
                                    sublayerName,
                                    L_.Map_
                                )
                            } else if (
                                typeof subUpdateLayers[sublayerName].layer
                                    .addData === 'function'
                            ) {
                                subUpdateLayers[sublayerName].layer.addData(
                                    geojson
                                )
                            }

                            if (sublayerName === 'image_overlays') {
                                subUpdateLayers[sublayerName].layer.setZIndex(
                                    L_._layersOrdered.length +
                                        1 -
                                        L_._layersOrdered.indexOf(layerName)
                                )
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log(e)
            console.warn(
                'Warning: Failed to update sublayers of layer: ' + layerName
            )
        }

        await L_.globeLithoLayerHelper(L_.layers.data[layerName], onlyClear)
    },
    clearVectorLayerInfo: function () {
        // Clear the InfoTools data
        const infoTool = ToolController_.getTool('InfoTool')
        if (infoTool && infoTool.hasOwnProperty('clearInfo')) {
            infoTool.clearInfo()
        }

        // Clear the description
        Description.clearDescription()
    },
    //Takes in a config layer object
    // Not just for globe
    globeLithoLayerHelper: async function (layerConfig, onlyClear) {
        if (L_.Globe_) {
            // Only toggle the layer to reset if the layer is toggled on,
            // because if the layer is toggled off, it is not on the globe
            if (L_.layers.on[layerConfig.name]) {
                // turn off
                await L_.toggleLayerHelper(layerConfig, true, true, true)
                // Toggle the layer so its drawn in the globe
                // turn on
                if (!onlyClear)
                    await L_.toggleLayerHelper(layerConfig, false, true, true)
            }
        }
    },
    parseConfig: parseConfig,

    resetConfig: async function (data) {
        // Save so we can make sure we reproduce the same layer settings after parsing the config
        const toggledArray = { ...L_.layers.on }

        // Reset for now
        L_.layers.on = {}

        // Reset as these are appended to by parseConfig
        L_._layersOrdered = []
        L_.layers.dataFlat = []
        L_._layersLoaded = []

        await L_.parseConfig(data)

        // Set back
        L_.layers.on = { ...L_.layers.on, ...toggledArray }
    },
    // Dynamically add a new layer or update a layer (used by WebSocket)
    modifyLayer: async function (data, layerName, type) {
        layerName = L_.asLayerUUID(layerName)

        const newLayersOrdered = [...L_._layersOrdered]
        const index = L_._layersOrdered.findIndex((name) => name === layerName)
        newLayersOrdered.splice(index, 1)

        if (type === 'updateLayer' && layerName in L_.layers.data) {
            // Update layer
            await L_.TimeControl_.reloadLayer(layerName, true, true)
        } else if (type === 'addLayer') {
            await L_.addLayerToLayersData(layerName)
        } else if (type === 'removeLayer') {
            await L_.removeLayerFromLayersData(layerName)
        }

        if (ToolController_.activeToolName === 'LayersTool') {
            const layersTool = ToolController_.getTool('LayersTool')
            if (layersTool.destroy && layersTool.make) {
                layersTool.destroy()
                layersTool.make()
            }
        }
    },
    addLayerToLayersData: async function (layerName) {
        if (L_.layers.data[layerName]) {
            // Recursively going through the new layer to get all of its sub layers
            const layersOrdered = L_.expandLayersToArray([
                L_.layers.data[layerName],
            ])

            if (!layersOrdered.includes(layerName)) {
                // If the new layer is a header, we need to add it to the list of layers
                layersOrdered.push(layerName)
            }
            layersOrdered.reverse()

            for (let i = 0; i < layersOrdered.length; i++) {
                // Add layer
                await L_.Map_.makeLayer(L_.layers.data[layersOrdered[i]])
                L_.addVisible(L_.Map_, [layersOrdered[i]])
            }
        }
    },
    removeLayerFromLayersData: async function (layerName) {
        if (L_.layers.data[layerName]) {
            // Recursively going through the removed layer to get all of its sub layers
            const layersOrdered = L_.expandLayersToArray([
                L_.layers.data[layerName],
            ])

            if (!layersOrdered.includes(layerName)) {
                // If the new layer is a header, we need to add it to the list of layers
                layersOrdered.push(layerName)
            }

            for (let i = 0; i < layersOrdered.length; i++) {
                const layerUUID = layersOrdered[i]

                // If the layer is visible, we need to remove it,
                // otherwise do nothing since its already removed from the map
                if (layerUUID in L_.layers.on && L_.layers.on[layerUUID]) {
                    // Toggle it to remove it
                    await L_.toggleLayer(L_.layers.data[layerUUID])
                }

                const display_name = L_.layers.data[layerUUID].display_name
                if (L_.layers.nameToUUID[display_name]) {
                    const index =
                        L_.layers.nameToUUID[display_name].indexOf(layerUUID)
                    if (index > -1) {
                        L_.layers.nameToUUID[display_name].splice(index, 1)
                    }
                    if (L_.layers.nameToUUID[display_name].length < 1) {
                        delete L_.layers.nameToUUID[display_name]
                    }
                }

                delete L_.layers.layer[layerUUID]
                delete L_.layers.data[layerUUID]
                delete L_.layers.on[layerUUID]
                delete L_.layers.attachments[layerUUID]
                delete L_.layers.opacity[layerUUID]
            }
        }
    },
    expandLayersToArray: function (layer) {
        // Recursively going through the removed layer to get all of its sub layers
        const layersOrdered = []
        expandLayers(layer, 0, null)

        function expandLayers(layerConfigs, level, prevName) {
            //Iterate over each layer
            for (let i = 0; i < layerConfigs.length; i++) {
                //Check if it's not a header and thus an actual layer with data
                if (layerConfigs[i].type != 'header') {
                    //Create parsed layers ordered
                    layersOrdered.push(layerConfigs[i].name)
                }

                //Get the current layers sublayers (returns 0 if none)
                var sublayerConfigs = getSublayers(layerConfigs[i])
                //If they are sublayers, call this function again and move up a level
                if (sublayerConfigs != 0) {
                    expandLayers(
                        sublayerConfigs,
                        level + 1,
                        layerConfigs[i].name
                    )
                }
            }
        }
        //Get the current layers sublayers (returns 0 if none)
        function getSublayers(layerConfig) {
            //If object layerConfig has a sublayers property, return it
            if (layerConfig.hasOwnProperty('sublayers')) {
                return layerConfig.sublayers
            }
            //Otherwise return 0
            return 0
        }

        return layersOrdered
    },
    updateLayersHelper: async function (layerQueueList) {
        if (layerQueueList.length > 0) {
            // If we have a few changes waiting in the queue, we only need to parse the config once
            // as the last item in the queue should have the latest data
            const lastLayer = layerQueueList[layerQueueList.length - 1]
            await L_.resetConfig(lastLayer.data)

            while (layerQueueList.length > 0) {
                const firstLayer = layerQueueList.shift()
                const { data, newLayerName, type } = firstLayer

                await L_.modifyLayer(data, newLayerName, type)
            }

            if (L_.Map_) L_.Map_.orderedBringToFront(true)

            // If the user rearranged the layers with the LayersTool, reset the ordering history
            if (
                ToolController_.toolModules['LayersTool'] &&
                ToolController_.toolModules['LayersTool'].orderingHistory
                    .length > 0
            ) {
                ToolController_.toolModules['LayersTool'].orderingHistory = []
            }

            // Update the LayersTool in the ToolController if it is active
            if (ToolController_.activeToolName === 'LayersTool') {
                ToolController_.activeTool.destroy()
                ToolController_.activeTool.make()
            }
        }
    },
    // Automatically update a single layer (i.e. add/update/remove) from WebSocket update
    autoUpdateLayer: async function (data, newLayerName, type) {
        await L_.updateLayersHelper([{ data, newLayerName, type }])
    },
    // Updates everything waiting in the queue from WebSocket updates
    updateQueueLayers: async function () {
        await L_.updateLayersHelper(L_.addLayerQueue)
    },
    // Limits a Local, Time-Enabled, Prop-set, vector layer to a range of time
    // start and end are unix timestamps
    timeFilterVectorLayer: function (layerName, start, end) {
        layerName = L_.asLayerUUID(layerName)

        let reset = false
        if (start === false) reset = true

        start = start || 0

        const layerConfig = L_.layers.data[layerName]
        const layer = L_.layers.layer[layerName]

        if (
            layerConfig.type === 'vector' &&
            layerConfig.time.type === 'local' &&
            layerConfig.time.endProp != null &&
            layer != false &&
            layer != null &&
            layer._sourceGeoJSON != null
        ) {
            const filteredGeoJSON = JSON.parse(
                JSON.stringify(
                    L_._localTimeFilterCache[layerName] || layer._sourceGeoJSON
                )
            )
            if (L_._localTimeFilterCache[layerName] == null)
                L_._localTimeFilterCache[layerName] = JSON.parse(
                    JSON.stringify(filteredGeoJSON)
                )

            if (reset === false) {
                filteredGeoJSON.features = filteredGeoJSON.features.filter(
                    (f) => {
                        let startTimeValue = false
                        if (layerConfig.time.startProp)
                            startTimeValue = F_.getIn(
                                f.properties,
                                layerConfig.time.startProp,
                                0
                            )
                        let endTimeValue = false
                        if (layerConfig.time.endProp)
                            endTimeValue = F_.getIn(
                                f.properties,
                                layerConfig.time.endProp,
                                false
                            )

                        // No prop, won't show
                        if (endTimeValue === false) return false

                        if (startTimeValue === false) {
                            //Single Point in time, just compare end times
                            let endDate = new Date(endTimeValue)
                            if (endDate == 'Invalid Date') return false

                            endDate = endDate.getTime()
                            if (endDate <= end && endDate >= start) return true
                            return false
                        } else {
                            // Then we have a range
                            let startDate = new Date(startTimeValue)
                            let endDate = new Date(endTimeValue)

                            // Bad prop value, won't show
                            if (
                                startDate == 'Invalid Date' ||
                                endDate == 'Invalid Date'
                            )
                                return false

                            startDate = startDate.getTime()
                            endDate = endDate.getTime()

                            if (end < startDate) return false
                            if (start > endDate) return false

                            return true
                        }
                    }
                )
            }
            // Update layer
            L_.clearVectorLayer(layerName)
            L_.updateVectorLayer(layerName, filteredGeoJSON)
        }
    },
    _updatePairings: function (layerName, on) {
        Object.keys(L_.layers.layer).forEach((name) => {
            if (
                L_.layers.on[name] &&
                L_.layers.attachments[name] &&
                L_.layers.attachments[name].pairings &&
                L_.layers.attachments[name].pairings.on &&
                L_.layers.attachments[name].pairings.pairedLayers.includes(
                    layerName
                )
            ) {
                L_.layers.attachments[name].pairings.layer.on(
                    false,
                    L_.layers.attachments[name].pairings.layer
                )
            }
        })
    },
    //Specific internal functions likely only to be used once
    getLayersChosenNamePropVal(feature, layer) {
        //These are what you'd think they'd be (Name could be thought of as key)
        let propertyNames, propertyValues
        let foundThroughVariables = false

        let layerName =
            typeof layer === 'string' ? layer : layer?.options?.layerName
        if (layerName != null) {
            const l = L_.layers.data[layerName]
            if (
                l &&
                l.hasOwnProperty('variables') &&
                l.variables.hasOwnProperty('useKeyAsName')
            ) {
                propertyNames = l.variables['useKeyAsName']
                if (typeof propertyNames === 'string')
                    propertyNames = [propertyNames]
                propertyValues = Array(propertyNames.length).fill(null)
                propertyNames.forEach((propertyName, idx) => {
                    if (
                        feature.properties.hasOwnProperty(propertyName) ||
                        l.getFeaturePropertiesOnClick === true
                    ) {
                        propertyValues[idx] = F_.getIn(
                            feature.properties,
                            propertyName
                        )
                        if (propertyValues[idx] != null)
                            foundThroughVariables = true
                    }
                })
            }
        }

        // Use first key that is not an object
        if (!foundThroughVariables) {
            for (let key in feature.properties) {
                //Default to show geometry type
                propertyNames = ['Type']
                propertyValues = [feature.geometry.type]

                //Be certain we have that key in the feature
                if (
                    feature.properties.hasOwnProperty(key) &&
                    (typeof feature.properties[key] === 'string' ||
                        typeof feature.properties[key] === 'number')
                ) {
                    //Store the current feature's key
                    propertyNames = [key]
                    //Store the current feature's value
                    propertyValues = [feature.properties[key]]
                    //Break out of for loop since we're done
                    break
                }
            }
        }
        return F_.stitchArrays(propertyNames, propertyValues)
    },
    // Returns all feature at a leaflet map click
    // e = {latlng: {lat, lng}, containerPoint?: {x, y}}
    getFeaturesAtPoint(e, fullLayers) {
        let features = []
        let correspondingLayerNames = []
        if (e.latlng && e.latlng.lng != null && e.latlng.lat != null) {
            // To better intersect points on click we're going to buffer out a small bounding box
            const mapRect = document
                .getElementById('map')
                .getBoundingClientRect()

            const wOffset = e.containerPoint?.x || mapRect.width / 2
            const hOffset = e.containerPoint?.y || mapRect.height / 2

            let nwLatLong = L_.Map_.map.containerPointToLatLng([
                wOffset - 15,
                hOffset - 15,
            ])
            let seLatLong = L_.Map_.map.containerPointToLatLng([
                wOffset + 15,
                hOffset + 15,
            ])
            // If we didn't have a container click point, buffer out e.latlng
            if (e.containerPoint == null) {
                const lngDif = Math.abs(nwLatLong.lng - seLatLong.lng) / 2
                const latDif = Math.abs(nwLatLong.lat - seLatLong.lat) / 2
                nwLatLong = {
                    lng: e.latlng.lng - lngDif,
                    lat: e.latlng.lat - latDif,
                }
                seLatLong = {
                    lng: e.latlng.lng + lngDif,
                    lat: e.latlng.lat + latDif,
                }
            }

            // Find all the intersected points and polygons of the click
            Object.keys(L_.layers.layer).forEach((lName) => {
                if (
                    (L_.layers.on[lName] &&
                        (L_.layers.data[lName].type === 'vector' ||
                            L_.layers.data[lName].type === 'query') &&
                        L_.layers.layer[lName]) ||
                    (lName.indexOf('DrawTool_') === 0 &&
                        L_.layers.layer[lName]?.[0]?._map != null)
                ) {
                    const nextFeatures = L.leafletPip
                        .pointInLayer(
                            [e.latlng.lng, e.latlng.lat],
                            L_.layers.layer[lName]
                        )
                        .concat(
                            F_.pointsInPoint(
                                [e.latlng.lng, e.latlng.lat],
                                L_.layers.layer[lName],
                                [
                                    nwLatLong.lng,
                                    seLatLong.lng,
                                    nwLatLong.lat,
                                    seLatLong.lat,
                                ]
                            )
                        )
                        .reverse()
                    features = features.concat(nextFeatures)
                    correspondingLayerNames = correspondingLayerNames.concat(
                        new Array(nextFeatures.length).fill().map(() => lName)
                    )
                }
            })

            if (features[0] == null) features = []
            else {
                const swapFeatures = []
                features.forEach((f) => {
                    if (
                        typeof f.type === 'string' &&
                        f.type.toLowerCase() === 'feature'
                    )
                        swapFeatures.push(f)
                    else if (
                        f.feature &&
                        typeof f.feature.type === 'string' &&
                        f.feature.type.toLowerCase() === 'feature'
                    )
                        swapFeatures.push(fullLayers ? f : f.feature)
                })
                features = swapFeatures
            }
        }
        return features
    },
    propertiesToImages(props, baseUrl) {
        baseUrl = baseUrl || ''
        var images = []
        //Use "images" key first
        if (props.hasOwnProperty('images')) {
            for (var i = 0; i < props.images.length; i++) {
                if (props.images[i].url) {
                    var url = baseUrl + props.images[i].url
                    if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                    if (props.images[i].isModel) {
                        images.push({
                            url: url,
                            texture: props.images[i].texture,
                            name:
                                (props.images[i].name ||
                                    props.images[i].url.match(
                                        /([^\/]*)\/*$/
                                    )[1]) + ' [Model]',
                            type: 'model',
                            isPanoramic: false,
                            isModel: true,
                            values: props.images[i].values || {},
                            master: props.images[i].master,
                        })
                    } else {
                        // Check if it's a video or gif file
                        const urlLower = url.toLowerCase()
                        const isVideo = urlLower.match(/\.(webm|mp4)$/) != null
                        const isGif = urlLower.match(/\.gif$/) != null

                        if (props.images[i].isPanoramic) {
                            images.push({
                                ...props.images[i],
                                url: url,
                                name:
                                    (props.images[i].name ||
                                        props.images[i].url.match(
                                            /([^\/]*)\/*$/
                                        )[1]) + ' [Panoramic]',
                                type: 'photosphere',
                                isPanoramic: true,
                                isModel: false,
                                values: props.images[i].values || {},
                                master: props.images[i].master,
                            })
                        }
                        images.push({
                            url: url,
                            name:
                                (props.images[i].name ||
                                    props.images[i].url.match(
                                        /([^\/]*)\/*$/
                                    )[1]) +
                                (isVideo ? ' [Video]' : '') +
                                (isGif ? ' [GIF]' : ''),
                            type:
                                props.images[i].type ||
                                (isVideo ? 'video' : 'image'),
                            isPanoramic: false,
                            isModel: false,
                            isVideo: isVideo,
                            isGif: isGif,
                            values: props.images[i].values || {},
                            master: props.images[i].master,
                        })
                    }
                }
            }
        }
        //Now search all string valued props for image urls

        for (let propName in props) {
            if (
                typeof props[propName] === 'string' &&
                props[propName]
                    .toLowerCase()
                    .match(/\.(jpeg|jpg|gif|png|xml)$/) != null
            ) {
                let url = props[propName]
                const isGif = url.toLowerCase().match(/\.gif$/) != null
                if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                images.push({
                    url: url,
                    name: propName + (isGif ? ' [GIF]' : ''),
                    isPanoramic: false,
                    isModel: false,
                    isGif: isGif,
                })
            } else if (
                typeof props[propName] === 'string' &&
                props[propName].toLowerCase().match(/\.(pdf)$/) != null
            ) {
                let url = props[propName]
                if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                images.push({
                    url: url,
                    name: propName,
                    type: 'document',
                    isPanoramic: false,
                    isModel: false,
                })
            } else if (
                typeof props[propName] === 'string' &&
                props[propName].toLowerCase().match(/\.(webm|mp4)$/) != null
            ) {
                let url = props[propName]
                if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                images.push({
                    url: url,
                    name: propName + ' [Video]',
                    type: 'video',
                    isPanoramic: false,
                    isModel: false,
                    isVideo: true,
                })
            } else if (
                typeof props[propName] === 'string' &&
                (props[propName].toLowerCase().match(/\.(obj)$/) != null ||
                    props[propName].toLowerCase().match(/\.(dae)$/) != null)
            ) {
                let url = props[propName]
                if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                images.push({
                    url: url,
                    name: propName,
                    isPanoramic: false,
                    isModel: true,
                })
            }
        }

        return images
    },
    _globalLoadings: [],
    _globalLoadingsTimeout: null,
    setGlobalLoading(uuid) {
        L_._globalLoadings.push(uuid)
        L_._globalLoadings = [...new Set(L_._globalLoadings)]
        clearTimeout(L_._globalLoadingsTimeout)
        L_._globalLoadingsTimeout = setTimeout(() => {
            $('#dataLoadingSpinner').css({ opacity: 1 })
        }, 500)
    },
    setGlobalLoaded(uuid) {
        L_._globalLoadings = L_._globalLoadings.filter(function (id) {
            return id !== uuid
        })
        if (L_._globalLoadings.length === 0) {
            clearTimeout(L_._globalLoadingsTimeout)
            $('#dataLoadingSpinner').css({ opacity: 0 })
        }
    },
    getListOfUsedGeoDatasets() {
        const list = []
        Object.keys(L_.layers.data).forEach((key) => {
            const layerConfig = L_.layers.data[key]
            if (layerConfig.url && layerConfig.url.startsWith('geodatasets:'))
                list.push({
                    display_name: layerConfig.display_name,
                    geodataset: layerConfig.url.replace('geodatasets:', ''),
                })
        })
        return list
    },
}

//Takes in a configData object and does a depth-first search through its
// layers and sets L_ variables
async function parseConfig(configData, urlOnLayers) {
    //Create parsed configData
    L_.configData = configData

    //find zero resolution
    if (
        L_.configData.projection &&
        L_.configData.projection.resunitsperpixel &&
        L_.configData.projection.reszoomlevel != null
    ) {
        var baseRes =
            L_.configData.projection.resunitsperpixel *
            Math.pow(2, L_.configData.projection.reszoomlevel)
        var res = []
        for (var i = 0; i < 32; i++) {
            res.push(baseRes / Math.pow(2, i))
        }
        L_.configData.projection.res = res
    }
    //Make bounds and origin floats
    if (L_.configData.projection && L_.configData.projection.bounds) {
        for (var i in L_.configData.projection.bounds)
            L_.configData.projection.bounds[i] = parseFloat(
                L_.configData.projection.bounds[i]
            )
    }
    if (L_.configData.projection && L_.configData.projection.origin) {
        for (var i in L_.configData.projection.origin)
            L_.configData.projection.origin[i] = parseFloat(
                L_.configData.projection.origin[i]
            )
    }

    // Use DB mission name for L_.mission (for deeplinks)
    // This will be set from the API response's mission field
    // For now, keep backward compatibility
    L_.mission = L_.configData._dbMissionName || L_.configData.msv.mission
    L_.recentMissions.unshift(L_.mission)
    // Use missionFolderName if available, otherwise fallback to msv.mission
    L_.missionFolderName =
        L_.configData.msv.missionFolderName || L_.configData.msv.mission
    L_.missionPath = 'Missions/' + L_.missionFolderName + '/'
    L_.site = L_.configData.msv.site

    L_.view = [
        parseFloat(L_.configData.msv.view[0]),
        parseFloat(L_.configData.msv.view[1]),
        parseInt(L_.configData.msv.view[2]),
    ]
    if (isNaN(L_.view[0])) L_.view[0] = 0
    if (isNaN(L_.view[1])) L_.view[1] = 0
    if (isNaN(L_.view[2])) L_.view[2] = 0

    L_.radius = L_.configData.msv.radius
    L_.masterdb = L_.configData.msv.masterdb || false

    // Remove tools that start have on: false (on null still allowed)
    L_.tools = []
    L_.configData.tools.forEach((t) => {
        if (t.on !== false) L_.tools.push(t)
    })

    if (L_.configData?.panels?.length != null) {
        L_.hasMap = L_.configData.panels.indexOf('map') > -1
        L_.hasMap = true //Should always have map;
        L_.hasViewer = L_.configData.panels.indexOf('viewer') > -1
        L_.hasGlobe = L_.configData.panels.indexOf('globe') > -1
    } else {
        L_.hasViewer = L_.configData.panels.viewer === true
        L_.hasGlobe = L_.configData.panels.globe === true
    }

    const _basemapProvider = L_.configData.msv?.basemap?.provider
    if (_basemapProvider && _basemapProvider !== 'none') {
        L_.hasGlobe = false
    }
    //We only care about the layers now
    const layers = L_.configData.layers

    //Begin recursively going through those layers
    await expandLayers(layers, 0, null)

    async function expandLayers(layerConfigs, level, prevName) {
        const stacRegex = /^stac(-((item)|(catalog)|(collection)))?:/i

        //Iterate over each layer
        for (let i = 0; i < layerConfigs.length; i++) {
            // If sourceType, prefix onto url
            if (
                layerConfigs[i].sourceType != null &&
                layerConfigs[i].sourceType !== 'url' &&
                layerConfigs[i].url.indexOf(
                    `${layerConfigs[i].sourceType}:`
                ) !== 0
            ) {
                layerConfigs[
                    i
                ].url = `${layerConfigs[i].sourceType}:${layerConfigs[i].url}`
            }

            // check if this is a vector STAC catalog or collection
            // if so, prefetch the data and replace this entry
            if (
                layerConfigs[i].type === 'vector' &&
                stacRegex.test(layerConfigs[i].url)
            ) {
                layerConfigs[i] = await getSTACLayers(layerConfigs[i])
            }

            // Quick hack to use uuid instead of name as main id
            layerConfigs[i].uuid = layerConfigs[i].uuid || layerConfigs[i].name
            if (L_.layers.nameToUUID[layerConfigs[i].name] == null)
                L_.layers.nameToUUID[layerConfigs[i].name] = []

            if (
                !L_.layers.nameToUUID[layerConfigs[i].name].includes(
                    layerConfigs[i].uuid
                )
            ) {
                L_.layers.nameToUUID[layerConfigs[i].name].push(
                    layerConfigs[i].uuid
                )
            }
            layerConfigs[i] = {
                display_name: layerConfigs[i].name,
                ...layerConfigs[i],
            }
            layerConfigs[i].name =
                layerConfigs[i].uuid || layerConfigs[i].name

            // Create parsed layers named
            L_.layers.data[layerConfigs[i].name] = layerConfigs[i]

            if (layerConfigs[i].display_name === 'TimeCogs') {
                layerConfigs[i].time.current = '2025-02-12T01:20:55Z'
                layerConfigs[i].time.start = ''
                layerConfigs[i].time.end = ''
                layerConfigs[i].time.startProp = ''
                layerConfigs[i].time.endProp = ''
                layerConfigs[i].time.refresh = '1 hours'
                layerConfigs[i].time.increment = '5 minutes'
            }

            if (
                layerConfigs[i].time &&
                layerConfigs[i].time.enabled === true &&
                layerConfigs[i].time.refreshIntervalEnabled === true
            ) {
                if (L_.layers.refreshIntervals[layerConfigs[i].name])
                    clearInterval(
                        L_.layers.refreshIntervals[layerConfigs[i].name]
                    )
                L_.layers.refreshIntervals[layerConfigs[i].name] = setInterval(
                    async () => {
                        if (L_.layers.on[layerConfigs[i].name] === true) {
                            let savedActiveFeature
                            if (
                                L_.activeFeature &&
                                L_.activeFeature.layerName ===
                                    layerConfigs[i].name
                            ) {
                                savedActiveFeature = {
                                    layerName: L_.activeFeature.layerName,
                                    feature: JSON.parse(
                                        JSON.stringify(L_.activeFeature.feature)
                                    ),
                                }
                            }
                            await L_.TimeControl_.reloadLayer(
                                layerConfigs[i].name,
                                false,
                                false,
                                true,
                                true
                            )
                            // Reselect activeFeature
                            if (
                                savedActiveFeature &&
                                savedActiveFeature.layerName ===
                                    layerConfigs[i].name
                            ) {
                                L_.selectFeature(
                                    savedActiveFeature.layerName,
                                    savedActiveFeature.feature
                                )
                            }
                        }
                    },
                    (layerConfigs[i].time.refreshIntervalAmount || 60) * 1000
                )
            }
            //Save the prevName for easy tracing back
            L_._layersParent[layerConfigs[i].name] = prevName

            // Set default kind to 'none'
            if (
                layerConfigs[i].type === 'vector' ||
                layerConfigs[i].type === 'vectortile' ||
                layerConfigs[i].type === 'query'
            ) {
                L_.layers.data[layerConfigs[i].name].kind =
                    layerConfigs[i].kind || 'none'
            }
            if (layerConfigs[i].type === 'vector') {
                layerConfigs[i].radius =
                    layerConfigs[i].style?.radius ||
                    layerConfigs[i].radius ||
                    8
            }

            //Check if it's not a header and thus an actual layer with data
            if (layerConfigs[i].type != 'header') {
                //Create parsed layers ordered
                L_._layersOrdered.push(layerConfigs[i].name)
                //Create parsed layers loaded
                if (
                    layerConfigs[i].type != 'data' &&
                    layerConfigs[i].type != 'model'
                )
                    //No load checking for model since it's globe only
                    L_._layersLoaded.push(false)
                else L_._layersLoaded.push(true)

                //relative or full path?
                let legendPath = layerConfigs[i].legend
                if (layerConfigs[i]?.variables?.legend) {
                    L_.layers.data[layerConfigs[i].name]._legend =
                        layerConfigs[i].variables.legend
                } else if (legendPath != undefined) {
                    if (!F_.isUrlAbsolute(legendPath))
                        legendPath = L_.missionPath + legendPath
                    $.get(
                        legendPath,
                        (function (name) {
                            return function (data) {
                                data = F_.csvToJSON(data)
                                L_.layers.data[name]._legend = data
                            }
                        })(layerConfigs[i].name)
                    )
                }

                // Set disabled time object if missing
                if (layerConfigs[i].time == null) {
                    layerConfigs[i].time = { enabled: false }
                }

                // Every engine's spelling of a raster tile layer, since the
                // tile server serves wmts regardless of which engine renders it.
                if (
                    isRasterTileLayerType(layerConfigs[i]) &&
                    layerConfigs[i].throughTileServer === true
                ) {
                    layerConfigs[i].tileformat = 'wmts'
                }
            }

            //Create parsed layers data
            L_.layers.dataFlat.push(layerConfigs[i])

            //Create parsed toggled array based on config layer visibility
            L_.layers.on[layerConfigs[i].name] =
                layerConfigs[i].visibility == undefined
                    ? true
                    : layerConfigs[i].visibility

            // Headers always start as true
            // Toggling header visibility toggles between all-off and previous-on states
            if (layerConfigs[i].type === 'header')
                L_.layers.on[layerConfigs[i].name] = true

            //Create parsed opacity array
            let io = layerConfigs[i].initialOpacity
            L_.layers.opacity[layerConfigs[i].name] =
                io == null || io < 0 || io > 1 ? 1 : io

            //Set visibility if we have all the on layers listed in the url
            if (urlOnLayers) {
                //this is null if we've no url layers
                let standardId = null
                if (urlOnLayers.onLayers.hasOwnProperty(layerConfigs[i].name))
                    standardId = layerConfigs[i].name
                else if (
                    urlOnLayers.onLayers.hasOwnProperty(
                        layerConfigs[i].display_name
                    )
                )
                    standardId = layerConfigs[i].display_name
                if (standardId != null) {
                    L_.layers.on[layerConfigs[i].name] = true
                    L_.layers.opacity[layerConfigs[i].name] =
                        urlOnLayers.onLayers[standardId].opacity || 1
                } else if (urlOnLayers.method == 'replace') {
                    L_.layers.on[layerConfigs[i].name] = false
                }
            }
            //Get the current layers sublayers (returns 0 if none)
            var sublayerConfigs = getSublayers(layerConfigs[i])
            //If they are sublayers, call this function again and move up a level
            if (sublayerConfigs != 0) {
                expandLayers(sublayerConfigs, level + 1, layerConfigs[i].name)
            }
        }
    }
    //Get the current layers sublayers (returns 0 if none)
    function getSublayers(layerConfig) {
        //If object layerConfig has a sublayers property, return it
        if (layerConfig.hasOwnProperty('sublayers')) {
            return layerConfig.sublayers
        }
        //Otherwise return 0
        return 0
    }

    // recurse through a STAC layer building sublayers
    function getSTACLayers(layerConfig) {
        return new Promise(async (resolve, reject) => {
            let stac_data
            const stacRegex =
                /^(?<prefix>stac(-((item)|(catalog)|(collection)))?:)?(?<url>.*)/i
            const urlMatch = layerConfig.url.match(stacRegex)
            if (!urlMatch) {
                console.warn('Could not process STAC URL')
                resolve(layerConfig)
            }
            const { prefix, url } = urlMatch.groups
            layerConfig.url = url // replace the current URL so we no longer need to worry about the special prefix
            if (prefix !== 'stac-item:') {
                $.ajax({
                    url: L_.getUrl('stac', layerConfig.url, layerConfig),
                    success: async (resp) => {
                        stac_data = resp
                        const path = layerConfig.url
                            .split('/')
                            .slice(0, -1)
                            .join('/')
                        const basename = F_.fileNameFromPath(layerConfig.url)
                        const stac_type = stac_data.type.toLowerCase()
                        if (stac_type === 'catalog') {
                            let sublayers = []
                            const children = stac_data.links.filter((l) =>
                                /^child/i.test(l.rel)
                            )
                            const promArr = []
                            for (let i = 0; i < children.length; i++) {
                                const uuid = `${layerConfig.uuid}-${i}`
                                promArr.push(
                                    getSTACLayers(
                                        Object.assign({}, layerConfig, {
                                            url: children[i].href.replace(
                                                './',
                                                `${path}/`
                                            ),
                                            display_name:
                                                children[i].title ||
                                                F_.fileNameFromPath(
                                                    children[i].href
                                                ),
                                            uuid: uuid,
                                            name: uuid,
                                        })
                                    )
                                )
                            }

                            try {
                                const subls = await Promise.all(promArr)
                                sublayers = sublayers.concat(subls)
                            } catch (err) {
                                console.warn(err)
                                resolve(layerConfig)
                            }

                            resolve(
                                Object.assign(
                                    {
                                        type: 'header',
                                        sublayers,
                                        description: '',
                                        display_name: '',
                                        name: '',
                                        uuid: '',
                                    },
                                    {
                                        description: layerConfig.description,
                                        display_name:
                                            layerConfig.display_name ||
                                            basename,
                                        name: layerConfig.name,
                                        uuid: layerConfig.uuid,
                                    }
                                )
                            )
                        } else if (stac_type === 'collection') {
                            const sublayers = []
                            const items = stac_data.links.filter((l) =>
                                /^item/i.test(l.rel)
                            )
                            for (let i = 0; i < items.length; i++) {
                                const uuid = `${layerConfig.uuid}-${i}`
                                sublayers.push(
                                    // we shouldn't need to pre-fetch item data
                                    Object.assign({}, layerConfig, {
                                        url: items[i].href.replace(
                                            './',
                                            `${path}/`
                                        ),
                                        display_name:
                                            items[i].title ||
                                            F_.fileNameFromPath(items[i].href),
                                        uuid: uuid,
                                        name: uuid,
                                    })
                                )
                            }
                            resolve(
                                Object.assign(
                                    {
                                        type: 'header',
                                        sublayers,
                                        description: '',
                                        display_name: '',
                                        name: '',
                                        uuid: '',
                                    },
                                    {
                                        description: layerConfig.description,
                                        display_name:
                                            layerConfig.display_name ||
                                            basename,
                                        name: layerConfig.name,
                                        uuid: layerConfig.uuid,
                                    }
                                )
                            )
                        } else if (/^feature(collection)?$/i.test(stac_type)) {
                            resolve(
                                Object.assign({}, layerConfig, {
                                    display_name:
                                        layerConfig.display_name || basename,
                                })
                            )
                        } else {
                            console.warn('Could not process STAC layer')
                            resolve(layerConfig)
                        }
                    },
                    error: (resp) => {
                        console.warn(resp)
                        resolve(layerConfig)
                    },
                })
            } else {
                resolve(layerConfig)
            }
        })
    }
}

window.L_ = L_
export default L_
