import L_ from '../Basics/Layers_/Layers_'
import F_ from '../Basics/Formulae_/Formulae_'
import ToolController_ from '../Basics/ToolController_/ToolController_'
import QueryURL from '../Ancillary/QueryURL'
import TimeControl from '../Basics/TimeControl_/TimeControl'
import Login from '../Ancillary/Login/Login'
import LegendTool from '../Tools/Legend/LegendTool.js'
import { PANEL_STATE } from '../Basics/PanelManager_/types/layout'
import mitt from 'mitt'

import $ from 'jquery'

let L = window.L

// ============ EVENT BUS INFRASTRUCTURE ============
// Using mitt for pub/sub events (200 bytes, battle-tested)
const events = mitt()

// Request/Response handler registry for async data retrieval
const handlers = new Map()

var mmgisAPI_ = {
    // Internal event bus access for core modules
    _events: events,
    _handlers: handlers,

    // Set by UserInterfaceModern_ on init; null when modern layout is not active
    _pluginController: null,
    // Set by UserInterfaceModern_ on init; null when modern layout is not active
    _panelManager: null,

    // Exposes Leaflet map object
    map: null,
    // Initialize the map variable
    fina: function (map_) {
        mmgisAPI_.map = map_.map
        mmgisAPI.map = map_.map
        if (typeof mmgisAPI_.onLoadCallback === 'function') {
            mmgisAPI_.onLoadCallback()
            mmgisAPI_.onLoadCallback = null
        }
    },
    setConfiguration: function (configuration) {
        if (window.mmgisglobal.setConfiguration)
            window.mmgisglobal.setConfiguration(configuration)
    },
    // Adds a layer to the map. For a more "temporary" layer, use Leaflet directly through `mmgisAPI.map`
    addLayer: function (layerObj, placement) {
        return new Promise(async (resolve, reject) => {
            if (layerObj == null) {
                reject('Missing parameter: layerObj')
                return
            }
            if (layerObj.name == null) {
                reject('Missing parameter: layerObj.name')
                return
            }
            if (layerObj.type == null) {
                reject('Missing parameter: layerObj.type')
                return
            }

            if (
                (layerObj.uuid || layerObj.name) &&
                L_.layers.data[layerObj.uuid || layerObj.name] != null
            ) {
                reject(
                    `Layer uuid/name already in use: '${
                        layerObj.uuid || layerObj.name
                    }'`
                )
                return
            }

            // Inject new layer into configData
            let placementPath = placement?.path
            let placementIndex = placement?.index

            const configData = JSON.parse(JSON.stringify(L_.configData))

            if (placementPath && typeof placementPath === 'string') {
                placementPath = placementPath
                    .split('.')
                    .map((p) => {
                        return L_.asLayerUUID(p)
                    })
                    .join('.')
                placementPath = placementPath
                    .replace(/\./g, '.sublayers.')
                    .split('.')
                    .concat('sublayers')
                    .join('.')

                const level = F_.getIn4Layers(
                    configData.layers,
                    placementPath,
                    null,
                    true
                )
                if (level == null) {
                    reject(
                        `Path specified in 'placement.path' not found in 'layers': ${placementPath}.`
                    )
                    return
                }
                if (placementIndex == null) placementIndex = level.length
                placementIndex = Math.max(
                    0,
                    Math.min(placementIndex, level.length)
                )

                placementPath += '.'
            } else {
                placementPath = ''
                if (placementIndex == null)
                    placementIndex = configData.layers.length
                placementIndex = Math.max(
                    0,
                    Math.min(placementIndex, configData.layers.length)
                )
            }

            const didSet = F_.setIn4Layers(
                configData.layers,
                `${placementPath}${placementIndex}`,
                layerObj,
                true,
                true
            )

            // Then add. resetConfig re-parses configData into L_.layers.data so the
            // new layer exists before modifyLayer renders it (matches the
            // updateLayersHelper/WebSocket flow). In-memory only — not persisted to
            // the backend, so added layers are lost on reload.
            if (didSet) {
                try {
                    await L_.resetConfig(configData)
                    await L_.modifyLayer(configData, layerObj.name, 'addLayer')
                } catch (err) {
                    reject(err)
                    return
                }
            } else {
                reject('Failed to add layer.')
                return
            }
            resolve()
        })
    },
    removeLayer: function (layerUUID) {
        const configData = JSON.parse(JSON.stringify(L_.configData))

        layerUUID = L_.asLayerUUID(layerUUID)
        let didRemove = false
        F_.traverseLayers(configData.layers, (layer, path, index) => {
            if (layer.uuid === layerUUID) {
                didRemove = true
                return 'remove'
            }
        })
        if (didRemove) {
            // Commit the stripped config, else the next addLayer's
            // resetConfig re-parses the removed layer back to life.
            L_.configData = configData
            L_.modifyLayer(configData, layerUUID, 'removeLayer')
            return true
        }
        return false
    },
    // Returns an array of all features in a given extent
    featuresContained: function () {
        if (!mmgisAPI_.map) {
            console.warn(
                'Warning: Unable to find features contained as the Leaflet map object is not initialized'
            )
        }

        const extent = mmgisAPI_.map.getBounds()
        let features = {}

        // For all MMGIS layers
        for (let key in L_.layers.layer) {
            if (L_.layers.layer[key] === false || L_.layers.layer[key] == null)
                continue

            if (L_.layers.layer[key].hasOwnProperty('_layers')) {
                // For normal layers
                const foundFeatures = findFeaturesInLayer(
                    extent,
                    L_.layers.layer[key]
                )
                features[key] = foundFeatures
            } else if (
                key.startsWith('DrawTool_') &&
                Array.isArray(L_.layers.layer[key])
            ) {
                // If layer is a DrawTool array of layers
                for (let layer in L_.layers.layer[key]) {
                    let foundFeatures
                    if (layer && L_.layers.layer[key][layer]) {
                        if ('getLayers' in L_.layers.layer[key][layer]) {
                            if (
                                L_.layers.layer[key][layer]?.feature?.properties
                                    ?.arrow
                            ) {
                                // If the DrawTool sublayer is an arrow
                                foundFeatures = findFeaturesInLayer(
                                    extent,
                                    L_.layers.layer[key][layer]
                                )

                                // As long as one of the layers of the arrow layer is in the current Map bounds,
                                // return the parent arrow layer's feature
                                if (foundFeatures && foundFeatures.length > 0) {
                                    foundFeatures =
                                        L_.layers.layer[key][layer].feature
                                }
                            } else {
                                // If the DrawTool sublayer is Polygon or Line
                                foundFeatures = findFeaturesInLayer(
                                    extent,
                                    L_.layers.layer[key][layer]
                                )
                            }
                        } else if ('getLatLng' in L_.layers.layer[key][layer]) {
                            // If the DrawTool sublayer is a Point
                            if (isLayerInBounds(L_.layers.layer[key][layer])) {
                                foundFeatures = [
                                    L_.layers.layer[key][layer].feature,
                                ]
                            }
                        }
                    }

                    if (foundFeatures) {
                        features[key] =
                            key in features
                                ? features[key].concat(foundFeatures)
                                : foundFeatures
                    }
                }
            }
        }

        return features

        function isLayerInBounds(layer) {
            // Use the pixel coordinates instead of latlong as latlong does not work well with polar projections
            const { x: xMapSize, y: yMapSize } = mmgisAPI_.map.getSize()

            const epsilon = 1e-6
            const nw = mmgisAPI_.map.project(extent.getNorthWest())
            const se = mmgisAPI_.map.project(extent.getSouthEast())
            const ne = mmgisAPI_.map.project(extent.getNorthEast())
            const sw = mmgisAPI_.map.project(extent.getSouthWest())

            let _extent
            if (
                Math.abs(Math.abs(nw.x - se.x) - xMapSize) < epsilon &&
                Math.abs(Math.abs(nw.y - se.y) - yMapSize) < epsilon
            ) {
                _extent = L.bounds(nw, se)
            } else {
                _extent = L.bounds(ne, sw)
            }

            let found = false
            if ('getBounds' in layer) {
                const layerBounds = layer.getBounds()
                const nwLayer = mmgisAPI_.map.project(
                    layerBounds.getNorthEast()
                )
                const seLayer = mmgisAPI_.map.project(
                    layerBounds.getSouthWest()
                )
                const _bounds = L.bounds(nwLayer, seLayer)

                if (_extent.intersects(_bounds)) {
                    found = true
                }
            } else if ('getLatLng' in layer) {
                const _latLng = mmgisAPI_.map.project(layer.getLatLng())

                if (_extent.contains(_latLng)) {
                    found = true
                }
            }

            return found
        }

        function findFeaturesInLayer(extent, layer) {
            let features = []
            const layers = layer.getLayers()

            layers.forEach((layer) => {
                const found = isLayerInBounds(layer)

                if (found) {
                    features.push(layer.feature)
                }
            })

            return features
        }
    },
    // Returns the currently active feature (i.e. feature thats clicked and displayed in the InfoTool)
    getActiveFeature: function () {
        const infoTool = ToolController_.getTool('InfoTool')

        if (infoTool.currentLayer && infoTool.currentLayer.feature) {
            const activeFeature = {}
            activeFeature[infoTool.currentLayerName] = [
                infoTool.currentLayer.feature,
            ]
            return activeFeature
        }

        return null
    },
    selectFeature: function (layerUUID, options) {
        return L_.selectPoint({
            ...{
                layerUUID: layerUUID,
            },
            ...options,
        })
    },
    getActiveTool: function () {
        if (ToolController_) {
            return {
                activeTool: ToolController_.activeTool,
                activeToolName: ToolController_.activeToolName,
            }
        }
        return null
    },
    getActiveTools: function () {
        if (ToolController_) {
            const activeTool = mmgisAPI_.getActiveTool()
            return {
                activeToolNames: [ToolController_.activeToolName]
                    .concat(ToolController_.activeSeparatedTools)
                    .filter(Boolean),
                activeTools: [activeTool.activeTool != null ? activeTool : null]
                    .concat(
                        ToolController_.activeSeparatedTools.map((a) => {
                            return {
                                activeTool: ToolController_.getTool(a),
                                activeToolName: a,
                            }
                        })
                    )
                    .filter(Boolean),
            }
        }
        return null
    },
    getLayerConfigs: function (match) {
        if (match) {
            const matchedLayers = {}
            Object.keys(L_.layers.data).forEach((name) => {
                const layer = L_.layers.data[name]
                let matched = false
                Object.keys(match).forEach((key) => {
                    const value = F_.getIn(layer, key)
                    if (typeof value === 'string' && match[key] === value)
                        matched = true
                    else if (Array.isArray(value) && value.includes(match[key]))
                        matched = true
                })

                if (matched)
                    matchedLayers[name] = JSON.parse(JSON.stringify(layer))
            })
            return matchedLayers
        } else return L_.layers.data
    },
    getLayers: function () {
        return L_.layers.layer
    },
    // Returns an object with the visibility state of all layers
    getVisibleLayers: function () {
        // Also return the visibility of the DrawTool layers
        var drawToolVisibility = {}
        for (let l in L_.layers.layer) {
            if (!(l in L_.layers.on)) {
                var s = l.split('_')
                var onId = s[1] != 'master' ? parseInt(s[1]) : s[1]
                if (s[0] == 'DrawTool') {
                    drawToolVisibility[l] =
                        ToolController_.getTool('DrawTool').filesOn.indexOf(
                            onId
                        ) != -1
                }
            }
        }

        return { ...L_.layers.on, ...drawToolVisibility }
    },
    //customListeners: {},
    // Adds map event listener
    addEventListener: function (eventName, functionReference) {
        const listener = mmgisAPI_.getLeafletMapEvent(eventName)
        const mmgisListener = mmgisAPI_.checkMMGISEvent(eventName)
        if (listener) {
            mmgisAPI_.map.addEventListener(listener, functionReference)
        } else if (mmgisListener) {
            document.addEventListener(eventName, functionReference)
        } else {
            //mmgisAPI_.customListeners[eventName] = mmgisAPI_.customListeners[eventName] || []
            //mmgisAPI_.customListeners[eventName].push(functionReference)
            console.warn(
                'Warning: Unable to add event listener for ' + eventName
            )
        }
    },
    // Removes map event listener added using the MMGIS API
    removeEventListener: function (eventName, functionReference) {
        const listener = mmgisAPI_.getLeafletMapEvent(eventName)
        const mmgisListener = mmgisAPI_.checkMMGISEvent(eventName)
        if (listener) {
            console.log('Remove listener:', listener)
            mmgisAPI_.map.removeEventListener(listener, functionReference)
        } else if (mmgisListener) {
            console.log('Remove listener', eventName)
            document.removeEventListener(eventName, functionReference)
        } else {
            //if(mmgisAPI_.customListeners[eventName]) {
            //    mmgisAPI_.customListeners[eventName] = mmgisAPI_.customListeners[eventName].filter(f => f !== functionReference)
            //}
            console.warn(
                'Warning: Unable to remove event listener for ' + eventName
            )
        }
    },
    getLeafletMapEvent: function (eventName) {
        if (eventName === 'onPan') {
            return 'dragend'
        } else if (eventName === 'onZoom') {
            return 'zoomend'
        } else if (eventName === 'onClick') {
            return 'click'
        }
        return null
    },
    checkMMGISEvent: function (eventName) {
        const validEvents = [
            'toolChange',
            'layerVisibilityChange',
            'websocketChange',
            'toggleSeparatedTool',
            'newActiveFeature',
            'layersToolHeaderStateChange',
            'madeLegendTool',
        ]
        return validEvents.includes(eventName)
    },
    writeCoordinateURL: function () {
        // The URL builder dereferences objects that only exist after mission
        // finalization; return null (the "no link yet" signal) until then.
        if (mmgisAPI_.map == null) return null
        return QueryURL.writeCoordinateURL()
    },
    copyText: function (text) {
        return F_.copyToClipboard(text)
    },
    getViewState: function () {
        // View metadata for plugins; fields are null until loaded.
        const map = L_.Map_ && L_.Map_.map
        const center =
            map && typeof map.getCenter === 'function' ? map.getCenter() : null
        return {
            // L_.mission is the canonical identity (the ?mission= URL value);
            // msv.mission is a display field that can be stale.
            missionName: L_.mission || L_.configData?.msv?.mission || null,
            time: L_.TimeControl_?.currentTime ?? null,
            center: center ? { lat: center.lat, lng: center.lng } : null,
            zoom:
                map && typeof map.getZoom === 'function'
                    ? map.getZoom()
                    : null,
        }
    },
    getMapScreenshot: function () {
        // Capture is engine-specific (Leaflet DOM rasterization vs deck.gl
        // canvas readback); delegate to the active IMapEngine adapter. A
        // missing engine means no map is loaded yet.
        const engine = L_.Map_ && L_.Map_.engine
        if (engine && typeof engine.captureScreenshot === 'function') {
            // Convert a sync engine throw into a rejection.
            try {
                return Promise.resolve(engine.captureScreenshot())
            } catch (err) {
                return Promise.reject(err)
            }
        }
        return Promise.reject(
            new Error('getMapScreenshot: no active map engine to capture')
        )
    },
    onLoadCallback: null,
    onLoaded: function (onLoadCallback) {
        mmgisAPI_.onLoadCallback = onLoadCallback
    },
    // Convert {lng: , lat:} to x, y
    project: function (lnglat) {
        return window.mmgisglobal.customCRS.project(lnglat)
    },
    // Convert {x: , y: } to lng, lat
    unproject: function (xy) {
        return window.mmgisglobal.customCRS.unproject(xy)
    },
    showPlugin: function (pluginId) {
        if (!mmgisAPI_._pluginController) {
            console.warn('[mmgisAPI] showPlugin: modern layout not active')
            return false
        }
        return mmgisAPI_._pluginController.showPlugin(pluginId)
    },
    hidePlugin: function (pluginId) {
        if (!mmgisAPI_._pluginController) {
            console.warn('[mmgisAPI] hidePlugin: modern layout not active')
            return false
        }
        return mmgisAPI_._pluginController.hidePlugin(pluginId)
    },
    loadPlugin: function (pluginId) {
        if (!mmgisAPI_._pluginController) {
            console.warn('[mmgisAPI] loadPlugin: modern layout not active')
            return false
        }
        return mmgisAPI_._pluginController.loadPlugin(pluginId)
    },
    unloadPlugin: function (pluginId) {
        if (!mmgisAPI_._pluginController) {
            console.warn('[mmgisAPI] unloadPlugin: modern layout not active')
            return false
        }
        return mmgisAPI_._pluginController.unloadPlugin(pluginId)
    },
    isPluginLoaded: function (pluginId) {
        return mmgisAPI_._pluginController?.isPluginLoaded(pluginId) ?? false
    },
    isPluginHidden: function (pluginId) {
        return mmgisAPI_._pluginController?.isPluginHidden(pluginId) ?? false
    },
    showPanel: function (panelId) {
        if (!mmgisAPI_._panelManager) {
            console.warn('[mmgisAPI] showPanel: modern layout not active')
            return false
        }
        try {
            const panel = mmgisAPI_._panelManager.getPanelState(panelId)
            if (!panel) {
                console.warn(`[mmgisAPI] showPanel: panel "${panelId}" not found`)
                return false
            }
            if (panel.state !== PANEL_STATE.COLLAPSED) return true
            mmgisAPI_._panelManager.togglePanelCollapsed(panelId)
            return true
        } catch (e) {
            console.warn('[mmgisAPI] showPanel failed:', e)
            return false
        }
    },
    hidePanel: function (panelId) {
        if (!mmgisAPI_._panelManager) {
            console.warn('[mmgisAPI] hidePanel: modern layout not active')
            return false
        }
        try {
            const panel = mmgisAPI_._panelManager.getPanelState(panelId)
            if (!panel) {
                console.warn(`[mmgisAPI] hidePanel: panel "${panelId}" not found`)
                return false
            }
            if (panel.state === PANEL_STATE.COLLAPSED) return true
            mmgisAPI_._panelManager.setPanelState(panelId, PANEL_STATE.COLLAPSED)
            return true
        } catch (e) {
            console.warn('[mmgisAPI] hidePanel failed:', e)
            return false
        }
    },
    togglePanel: function (panelId) {
        if (!mmgisAPI_._panelManager) {
            console.warn('[mmgisAPI] togglePanel: modern layout not active')
            return false
        }
        try {
            mmgisAPI_._panelManager.togglePanelCollapsed(panelId)
            return true
        } catch (e) {
            console.warn('[mmgisAPI] togglePanel failed:', e)
            return false
        }
    },
    _initCoreCommandDispatcher: function () {
        const handlers = {
            'core:showPlugin':   ({ pluginId }) => mmgisAPI_.showPlugin(pluginId),
            'core:hidePlugin':   ({ pluginId }) => mmgisAPI_.hidePlugin(pluginId),
            'core:loadPlugin':   ({ pluginId }) => mmgisAPI_.loadPlugin(pluginId),
            'core:unloadPlugin': ({ pluginId }) => mmgisAPI_.unloadPlugin(pluginId),
            'core:showPanel':    ({ panelId })  => mmgisAPI_.showPanel(panelId),
            'core:hidePanel':    ({ panelId })  => mmgisAPI_.hidePanel(panelId),
            'core:togglePanel':  ({ panelId })  => mmgisAPI_.togglePanel(panelId),
        }
        Object.entries(handlers).forEach(([ev, fn]) => events.on(ev, fn))
        return () => Object.entries(handlers).forEach(([ev, fn]) => events.off(ev, fn))
    },
    toggleLayer: async function (layerName, on) {
        if (layerName in L_.layers.data) {
            if (on === undefined || on === null) {
                // If on is not defined, switch the visibility state of the layer
                await L_.toggleLayer(L_.layers.data[layerName])
            } else {
                let state = !on
                await L_.toggleLayerHelper(L_.layers.data[layerName], state)
            }

            if (ToolController_.activeToolName === 'LayersTool') {
                const id = `#layerstart${F_.getSafeName(layerName)} .checkbox`

                if (L_.layers.on[layerName]) {
                    $(id).addClass('on')
                } else {
                    $(id).removeClass('on')
                }
            }
        } else {
            console.warn(`'Warning: Unable to find layer named ${layerName}`)
            return
        }
    },
}

var mmgisAPI = {
    /**
     * Sets a new configuration object for MMGIS to use
     * @param {object} configurationObj - The new configuration JSON object (what the configuration CMS creates)
     */
    setConfiguration: mmgisAPI_.setConfiguration,
    /**
     * Adds a layer to the map. For a more "temporary" layer, use Leaflet directly through `mmgisAPI.map`
     * @param {object} layerObj - See schema in configData
     * @param {object} placement - Position to place layer relative to other layers - {path: , index: }
     * @returns {Promise}
     */
    addLayer: mmgisAPI_.addLayer,
    /**
     * Removes a layer from the map.
     * @params {string} layerUUID - layer name/uuid to remove
     * @returns {boolean} - true if found and removed, otherwise false
     */
    removeLayer: mmgisAPI_.removeLayer,
    /**
     * Clears a layer with a specified name
     * @param {string} - layerName - name of layer to clear
     */
    clearVectorLayer: L_.clearVectorLayer,
    /**
     * Updates a specified layer with GeoJSON data
     * @param {string} - layerName - name of layer to update
     * @param {GeoJSON} - inputData - valid GeoJSON data
     */
    updateVectorLayer: L_.updateVectorLayer,
    /**
     * Remove features on a specified layer before a specified time
     * @param {string} - layerName - name of layer to update
     * @param {string} - keepAfterTime - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; will keep all features after this time
     * @param {number} - timePropPath - name of time property to compare with the time specified by keepAfterTime
     */
    trimVectorLayerKeepAfterTime: L_.trimVectorLayerKeepAfterTime,
    /**
     * Remove features on a specified layer after a specified time
     * @param {string} - layerName - name of layer to update
     * @param {string} - keepBeforeTime - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; will keep all features before this time
     * @param {number} - timePropPath - name of time property to compare with the time specified by keepAfterTime
     */
    trimVectorLayerKeepBeforeTime: L_.trimVectorLayerKeepBeforeTime,
    /**
     * Number of features to keep on a specified layer. Keeps from the tail end of the feature list.
     * @param {string} - layerName - name of layer to update
     * @param {keepLastN} - keepN - number of features to keep from the tail end of the feature list. A value less than or equal to 0 keeps all previous features
     */
    keepLastN: L_.keepLastN,
    /**
     * Number of features to keep on a specified layer. Keeps features from the beginning of the feature list.
     * @param {string} - layerName - name of layer to update
     * @param {keepFirstN} - keepN - number of features to keep from the beginning of the feature list. A value less than or equal to 0 keeps all previous features
     */
    keepFirstN: L_.keepFirstN,
    /**
     * This function is used to trim a specified number of vertices on a specified layer containing GeoJson LineString features.
     * @param {string} - layerName - name of layer to update
     * @param {string} - time - absolute time in the format of YYYY-MM-DDThh:mm:ssZ; represents start time if trimming from the beginning, otherwise represents the end time
     * @param {number} - trimN - number of vertices to trim
     * @param {string} - startOrEnd - direction to trim from; value can only be one of the following options: start, end
     */
    trimLineString: L_.trimLineString,
    /**
     * This function is used to append new LineString data to the last feature (with LineString geometry) in a layer
     * @param {string} - layerName - name of layer to update
     * @param {object} - inputData - a GeoJson Feature object containing geometry that is a LineString
     * @param {string} - timeProp - name of time property in each feature in the layer and in the inputData
     */
    appendLineString: L_.appendLineString,

    // Time Control API functions

    /**
     * This function toggles the visibility of ancillary Time Control User Interface.
     * It is useful in situations where time functions are controlled by an external application.
     * @param {boolean} - Whether to turn the TimeUI on or off. If true, makes visible.
     * @returns {boolean} - Whether the TimeUI is now on or off
     */
    toggleTimeUI: TimeControl.toggleTimeUI,

    /**
     * This function sets the global time properties for all of MMGIS.
     * All time enabled layers that are configured to use the `Global` time type will be updated by this function.
     * @param {string} [startTime] - Can be either YYYY-MM-DDThh:mm:ssZ if absolute or hh:mm:ss or seconds if relative
     * @param {string} [endTime] - Can be either YYYY-MM-DDThh:mm:ssZ if absolute or hh:mm:ss or seconds if relative
     * @param {boolean} [isRelative=false] - If true, startTime and endTime are relative to currentTime
     * @param {string} [timeOffset=0] - Offset of currentTime; Can be either hh:mm:ss or seconds
     * @returns {boolean} - Whether the time was successfully set
     */
    setTime: TimeControl.setTime,

    /** This function sets the start and end time for a single layer.
     * It will override the global time for that layer.
     * @param {string} [layerName]
     * @param {string} [startTime] - YYYY-MM-DDThh:mm:ssZ
     * @param {string} [endTime] - YYYY-MM-DDThh:mm:ssZ
     * @returns {boolean} - Whether the time was successfully set
     */
    setLayerTime: TimeControl.setLayerTime,

    /**
     * @returns {string} - The current time on the map with offset included
     */
    getTime: TimeControl.getTime,

    /**
     * @returns {string} - The start time on the map with offset included
     */
    getStartTime: TimeControl.getStartTime,

    /**
     * @returns {string} - The end time on the map with offset included
     */
    getEndTime: TimeControl.getEndTime,

    /**
     * @param {string} [layerName]
     * @returns {string} - The start time for an individual layer
     */
    getLayerStartTime: TimeControl.getLayerStartTime,

    /**
     * @param {string} [layerName]
     * @returns {string} - The end time for an individual layer
     */
    getLayerEndTime: TimeControl.getLayerEndTime,

    /** reloadTimeLayers will reload every time enabled layer
     * @returns {array} - A list of layers that were reloaded
     */
    reloadTimeLayers: TimeControl.reloadTimeLayers,

    /** reloadLayer will reload a given time enabled layer
     * @param {string} [layerName]
     * @returns {boolean} - Whether the layer was successfully reloaded
     */
    reloadLayer: TimeControl.reloadLayer,

    /** Sets layer UUIDs and layer Names to UUIDs
     * @param {string} [uuid]
     * @returns {string} - Best UUID, else null
     */
    asLayerUUID: L_.asLayerUUID,

    /** setLayersTimeStatus - will set the status color for all global time enabled layers
     * @param {string} [color]
     * @returns {array} - A list of layers that were set
     */
    setLayersTimeStatus: TimeControl.setLayersTimeStatus,

    /** setLayerTimeStatus - will set the status color for the given layer
     * @param {string} [layerName]
     * @param {string} [color]
     * @returns {boolean} - True if time status was successfully set
     */
    setLayerTimeStatus: TimeControl.setLayerTimeStatus,

    /** updateLayersTime - will synchronize every global time enabled layer with global times.
     * Probably should be a private function, but could be useful for edge cases when things
     * may need to be re-synchronized.
     * @returns {array} - A list of layers that were reloaded
     */
    updateLayersTime: TimeControl.updateLayersTime,

    /** map - exposes Leaflet map object.
     * @returns {object} - The Leaflet map object
     */
    map: null,

    /** featuresContained - returns an array of all features in the current map view.
     * @returns {object} - An object containing layer names as keys and values as arrays with all features (as GeoJson Feature objects) contained in the current map view
     */
    featuresContained: mmgisAPI_.featuresContained,

    /** getActiveFeature - returns the currently active feature (i.e. feature thats clicked and displayed in the InfoTool)
     * @returns {object} - The currently selected active feature as an object with the layer name as key and value as an array containing the GeoJson Feature object (MMGIS only allows the section of a single feature).
     */
    getActiveFeature: mmgisAPI_.getActiveFeature,

    /** Selects a feature based on latlng, key:value, or layerId
     * @param {string} [layerName]
     * @param {object} [options]
     * options: {
        lat: num,
        lon: num,
        ||
        key: 'props.dot.notation',
        value: '',
        ||
        layerId: num,

        view: 'go' || null,
        zoom: 'zoomLevel' || 'map_scale_if_view_is_go',
        }
     *
     * @returns {boolean} - true if found and selected a feature, otherwise false
     */
    selectFeature: mmgisAPI_.selectFeature,

    /** getActiveTool - returns the currently active tool
     * @returns {object} - The currently active tool and the name of the active tool as an object.
     */
    getActiveTool: mmgisAPI_.getActiveTool,

    /** getActiveTools - returns the currently active tool
     * @returns {object} - The currently active tool and the name of the active tool as an object.
     */
    getActiveTools: mmgisAPI_.getActiveTools,

    /** getLayerConfigs - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getLayerConfigs: mmgisAPI_.getLayerConfigs,
    /** getLayers - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getLayers: mmgisAPI_.getLayers,

    /** getVisibleLayers - returns an object with the visibility state of all layers
     * @returns {object} - an object containing the visibility state of each layer
     */
    getVisibleLayers: mmgisAPI_.getVisibleLayers,

    /** addEventListener - adds map event or MMGIS action listener.
     * @param {string} - eventName - name of event to add listener to. Available events: onPan, onZoom, onClick, toolChange, layerVisibilityChange, toggleSeparatedTool, newActiveFeature, layersToolHeaderStateChange, madeLegendTool

     * @param {function} - functionReference - function reference to listener event callback function. null value removes all functions for a given eventName

     */
    addEventListener: mmgisAPI_.addEventListener,

    /** removeEventListener - removes map event or MMGIS action listener added using the MMGIS API.
     * @param {string} - eventName - name of event to add listener to. Available events: onPan, onZoom, onClick, toolChange, layerVisibilityChange, toggleSeparatedTool, newActiveFeature
     * @param {function} - functionReference - function reference to listener event callback function. null value removes all functions for a given eventName
     */
    removeEventListener: mmgisAPI_.removeEventListener,

    /** writeCoordinateURL - writes out the current view as a url. This returns the long form of
     * the 'Copy Link' feature and does not save a short url to the database.
     * @returns {string|null} - a string containing the current view as a url, or null if the mission has not finished loading yet
     * Plugins should prefer `mmgisAPI.request('map:writeCoordinateURL')`.
     */
    writeCoordinateURL: mmgisAPI_.writeCoordinateURL,

    /** getViewState - returns metadata about the current view (for example to
     * build provenance-rich export filenames). Fields are null until the
     * mission has loaded far enough to answer them.
     * @returns {object} {missionName: string|null, time: string|null, center: {lat, lng}|null, zoom: number|null}
     * Plugins should prefer `mmgisAPI.request('map:getViewState')`.
     */
    getViewState: mmgisAPI_.getViewState,

    /** copyText - copies text to the user's clipboard. Uses the async
     * Clipboard API with a legacy fallback for insecure origins. Note: pages
     * embedding MMGIS in an iframe (FRAME_ANCESTORS) must set
     * allow="clipboard-write" for the modern path.
     * @param {string} text - text to copy
     * @returns {Promise<boolean>} true on success, false on failure — never rejects
     * Plugins should prefer `mmgisAPI.request('app:copyText', text)`.
     */
    copyText: mmgisAPI_.copyText,

    /** getMapScreenshot - captures a PNG screenshot of the current map view.
     * Delegates to the active map engine, so the capture strategy is
     * engine-specific: the Leaflet engine rasterizes its DOM (hiding UI chrome
     * for the shot), while the deck.gl/GL engine reads its WebGL canvas. Note
     * that the deck.gl capture is limited to the GL canvas and does not include
     * HTML overlays/markers layered on top. Asynchronous; requires no backend
     * call. Rejects if no map engine is active.
     * @returns {Promise<{blob: Blob, mimeType: 'image/png', extension: 'png', width: number, height: number}>} - resolves to a PNG Blob plus image metadata.
     * Plugins should prefer `mmgisAPI.request('map:getScreenshot')`.
     */
    getMapScreenshot: mmgisAPI_.getMapScreenshot,

    /** onLoaded - calls onLoadCallback as a function once MMGIS has finished loading.
     * @param {function} - onLoadCallback - function reference to function that is called when MMGIS is finished loading
     */
    onLoaded: mmgisAPI_.onLoaded,

    /** initialLogin: performs the initial login call to relogin returning users. Pairable with the ENV `SKIP_CLIENT_INITIAL_LOGIN=`.
     */
    initialLogin: Login.initialLogin,

    /** project - converts a lnglat into xy coordinates with the current (custom or default web mercator) proj4 definition
     * @param {object} {lng: 0, lat: 0} - lnglat to convert
     * @returns {object} {x: 0, y: 0} - converted easting northing xy
     */
    project: mmgisAPI_.project,

    /** unproject - converts an xy into lnglat coordinates with the current (custom or default web mercator) proj4 definition
     * @returns {object} {x: 0, y: 0} - easting northing xy to convert
     * @param {object} {lng: 0, lat: 0} - converted lnglat
     */
    unproject: mmgisAPI_.unproject,

    /** toggleLayer - set the visibility state for a named layer
     * @param {string} - layerName - name of layer to set visibility
     * @param {boolean} - on - (optional) Set true if the visibility should be on or false if visibility should be off. If not set, the current visibility state will switch to the opposite state.
     */
    toggleLayer: mmgisAPI_.toggleLayer,

    /** setBasemap - switches the active basemap style by name.
     * Style names come from msv.basemap.styles[] in the mission config,
     * or the provider defaults if no styles are configured.
     * @param {string} styleName - display name of the style (e.g. 'Streets', 'Liberty')
     * @returns {Promise<boolean>} - true if found and applied, false if not found
     */
    setBasemap: (styleName) => mmgisAPI.request('map:setBasemap', styleName),

    /** getBasemap - returns the currently active basemap style.
     * @returns {Promise<{name: string, style: string} | null>}
     */
    getBasemap: () => mmgisAPI.request('map:getBasemap'),

    /** getBasemapStyles - returns all available basemap style options.
     * @returns {Promise<Array<{name: string, style: string}>>}
     */
    getBasemapStyles: () => mmgisAPI.request('map:getBasemapStyles'),

    /** zoomIn - increments the map zoom by 1 level, clamped to the max zoom.
     * @returns {Promise<boolean>} - true if zoom changed, false if already at max
     */
    zoomIn: () => mmgisAPI.request('map:zoomIn'),

    /** zoomOut - decrements the map zoom by 1 level, clamped to the min zoom.
     * @returns {Promise<boolean>} - true if zoom changed, false if already at min
     */
    zoomOut: () => mmgisAPI.request('map:zoomOut'),

    /** latLngToContainerPoint - project a {lat, lng} to pixel coordinates
     * relative to the map container. Useful for positioning DOM overlays.
     * @param {{lat: number, lng: number}} latlng
     * @returns {Promise<{x: number, y: number} | null>}
     */
    latLngToContainerPoint: (latlng) => mmgisAPI.request('map:latLngToContainerPoint', latlng),
    // ============ PLUGIN LIFECYCLE API (modern layout only) ============

    /**
     * Show a hidden plugin. The plugin must be loaded; its internal state is preserved.
     * @param {string} pluginId - Tool ID (e.g., 'TitleTool')
     * @returns {boolean} True if shown, false if plugin not found or layout not active
     */
    showPlugin: mmgisAPI_.showPlugin,

    /**
     * Hide a plugin without destroying it. State is preserved; showPlugin restores it.
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if hidden, false if plugin not found or layout not active
     */
    hidePlugin: mmgisAPI_.hidePlugin,

    /**
     * Load a plugin that is currently deferred (startUnloaded at init, or previously unloaded).
     * Calls make() on the existing DOM container. The plugin starts visible.
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if loaded, false if not found or load failed
     */
    loadPlugin: mmgisAPI_.loadPlugin,

    /**
     * Fully unload a plugin, calling destroy() and releasing all resources.
     * The DOM container remains so loadPlugin can recreate it later.
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if unloaded, false if not found or layout not active
     */
    unloadPlugin: mmgisAPI_.unloadPlugin,

    /**
     * Check whether a plugin is currently loaded (make() has been called and not destroyed).
     * @param {string} pluginId - Tool ID
     * @returns {boolean}
     */
    isPluginLoaded: mmgisAPI_.isPluginLoaded,

    /**
     * Check whether a plugin is not currently visible — either explicitly hidden
     * via hidePlugin/startHidden while loaded, or deferred/unloaded (startUnloaded,
     * or unloadPlugin). Use isPluginLoaded alongside this to tell the two apart.
     * @param {string} pluginId - Tool ID
     * @returns {boolean}
     */
    isPluginHidden: mmgisAPI_.isPluginHidden,

    /**
     * Show a collapsed panel, restoring its last visible state.
     * @param {string} panelId - Panel ID
     * @returns {boolean} True if shown, false if not found or layout not active
     */
    showPanel: mmgisAPI_.showPanel,

    /**
     * Collapse a panel without destroying its contents.
     * @param {string} panelId - Panel ID
     * @returns {boolean} True if hidden, false if not found or layout not active
     */
    hidePanel: mmgisAPI_.hidePanel,

    /**
     * Toggle a panel between collapsed and its last visible state.
     * @param {string} panelId - Panel ID
     * @returns {boolean} True if toggled, false if not found or layout not active
     */
    togglePanel: mmgisAPI_.togglePanel,

    /** overwriteLegends - overwrite the contents displayed in the LegendTool; useful when used with `toggleSeparatedTool` event listener in mmgisAPI
     * @param {array} - legends - an array of objects, where each object must contain the following keys: legend, layerUUID, display_name, opacity. The value for the legend key should be in the same format as what is stored in the layers data under the `_legend` key (i.e. `L_.layers.data[layerName]._legend`). layerUUID and display_name should be strings and opacity should be a number between 0 and 1.
     */
    overwriteLegends: LegendTool.overwriteLegends,

    // ============ EVENT BUS API ============

    /**
     * Subscribe to an event
     * @param {string} event - Event name (e.g., 'layer:toggle', 'time:changed', 'tool:change')
     * @param {function} callback - Handler function that receives event data
     * @returns {function} - Unsubscribe function to remove the listener
     * @example
     * const unsubscribe = mmgisAPI.on('layer:toggle', (data) => console.log(data));
     * // Later: unsubscribe();
     */
    on: (event, callback) => {
        events.on(event, callback)
        return () => events.off(event, callback)
    },

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {function} callback - Handler function to remove
     * @example
     * mmgisAPI.off('layer:toggle', myHandler);
     */
    off: events.off,

    /**
     * Emit an event to all subscribers
     * @param {string} event - Event name
     * @param {*} data - Event data to pass to subscribers
     * @example
     * mmgisAPI.emit('layer:toggle', { layerName: 'Terrain', visible: true });
     */
    emit: events.emit,

    // ============ REQUEST/RESPONSE API ============

    /**
     * Register a request handler (data provider)
     * @param {string} name - Request name (e.g., 'map:getCenter', 'plugin:info:showFeature')
     * @param {function} handler - Async handler function that returns data.
     * Called as `handler(data, caller)`: `caller` is the id of the plugin
     * whose handle made the request, absent for one made without a handle.
     * A handler registered point-free is handed it too.
     * @returns {function} - Cleanup function to remove the handler
     * @example
     * const cleanup = mmgisAPI.provide('map:getCenter', () => Map_.map.getCenter());
     * // Later: cleanup();
     */
    provide(name, handler) {
        if (handlers.has(name)) {
            console.warn(`[mmgisAPI] Handler "${name}" is being replaced`)
        }
        handlers.set(name, handler)
        return () => handlers.delete(name)
    },

    /**
     * Make a request to a registered handler
     * @param {string} name - Request name
     * @param {*} data - Request data to pass to the handler
     * @param {string} [caller] - Id of the plugin making the request, handed to
     * the handler beside the data rather than mixed into it, so a payload of
     * any shape — a string, an array, nothing at all — reaches the handler as
     * it was written. Plugins do not pass this themselves: `forPlugin`'s
     * `request` stamps it, which is the whole reason it is worth anything.
     * @returns {Promise<*>} - Promise that resolves to handler's response
     * @throws {Error} - If no handler is registered for the request name
     * @example
     * const center = await mmgisAPI.request('map:getCenter');
     * const layers = await mmgisAPI.request('layers:getVisible');
     */
    async request(name, data, caller) {
        const handler = handlers.get(name)
        if (!handler) {
            throw new Error(`[mmgisAPI] No handler for: "${name}"`)
        }
        return await handler(data, caller)
    },

    /**
     * Check if a handler is registered for a request name
     * @param {string} name - Request name to check
     * @returns {boolean} - True if handler exists
     * @example
     * if (mmgisAPI.hasHandler('map:getCenter')) { ... }
     */
    hasHandler(name) {
        return handlers.has(name)
    },

    // ============ PLUGIN-SCOPED API ============

    /**
     * Get a plugin-scoped API for emitting events, providing handlers, and
     * reading the plugin's tool configuration. Event/handler names are
     * automatically prefixed with 'plugin:{pluginId}:'.
     *
     * `request` is here too, but unprefixed — it names another provider, not
     * one of this plugin's. Going through the handle is what stamps the
     * plugin's id on the request, so prefer it to `mmgisAPI.request`: some
     * providers answer differently, or not at all, when they cannot tell who
     * is asking. For subscribing (on), use mmgisAPI directly with full paths.
     *
     * @param {string} pluginId - Unique plugin identifier (e.g., 'draw', 'info', 'layerManager')
     * @returns {Object} Scoped API with emit, provide, request and getVars methods
     * @example
     * const api = mmgisAPI.forPlugin('draw');
     *
     * // Emitting/providing (auto-prefixed)
     * api.provide('getActiveFeature', () => data);  // -> 'plugin:draw:getActiveFeature'
     * api.emit('featureUpdated', data);             // -> 'plugin:draw:featureUpdated'
     *
     * // Reading this plugin's configured tool variables
     * const vars = api.getVars();                    // -> L_.getToolVars('draw') || {}
     *
     * // Requesting (full names, stamped with 'draw' as the caller)
     * api.request('plugin:info:getData');
     * api.request('map:hidePopup');                  // retracts draw's popup only
     *
     * // Subscribing (use mmgisAPI directly)
     * mmgisAPI.on('layer:visibilityChange', handler);
     */
    forPlugin(pluginId) {
        const prefix = `plugin:${pluginId}:`

        // Auto-register this plugin's tool variables as a queryable provider so
        // any consumer (including sandboxed marketplace plugins, where direct
        // method calls aren't possible) can read it via the standard request
        // pattern: `mmgisAPI.request('plugin:{id}:getVars')`. The scoped
        // `getVars()` below is a sync convenience for the plugin's own code.
        mmgisAPI.provide(`${prefix}getVars`, () => L_.getToolVars(pluginId) || {})

        return {
            emit: (event, data) => mmgisAPI.emit(prefix + event, data),
            provide: (name, handler) => mmgisAPI.provide(prefix + name, handler),
            // Not prefixed, unlike emit/provide: those name this plugin's own
            // events and handlers, while a request addresses someone else's
            // provider and so takes the full name. The plugin's id rides along
            // beside the payload, so a provider can tell who is asking — which
            // is how core knows whose popup a `map:hidePopup` may retract.
            request: (name, data) => mmgisAPI.request(name, data, pluginId),
            getVars: () => L_.getToolVars(pluginId) || {},
            pluginId,
            prefix,
        }
    },

    // Formulae_
    utils: { ...F_ },
}

window.mmgisAPI = mmgisAPI

// The share capabilities are also registered on the request/provide bus —
// the channel plugins are expected to use (string-named requests survive a
// postMessage sandbox boundary; direct method calls don't). The direct
// methods above remain for pages embedding MMGIS. Registered at module
// scope so hasHandler() is true from page load; each implementation guards
// its own readiness (null / rejection until the mission and engine exist).
mmgisAPI.provide('map:writeCoordinateURL', () =>
    mmgisAPI_.writeCoordinateURL()
)
mmgisAPI.provide('map:getViewState', () => mmgisAPI_.getViewState())
mmgisAPI.provide('map:getScreenshot', () => mmgisAPI_.getMapScreenshot())
mmgisAPI.provide('app:copyText', (text) =>
    // Bus payloads arrive from arbitrary plugins; refuse non-strings rather
    // than clobber the user's clipboard with a coerced 'undefined'.
    typeof text === 'string' ? mmgisAPI_.copyText(text) : Promise.resolve(false)
)

export { mmgisAPI_, mmgisAPI }
