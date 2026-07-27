// TimeControl sets up a div that displays the time controller
import { utcFormat } from 'd3-time-format'
import * as moment from 'moment'
import $ from 'jquery'
import F_ from '../Formulae_/Formulae_'
import L_ from '../Layers_/Layers_'
import Map_ from '../Map_/Map_'
import TimeUI from './TimeUI'
import {
    compileTileUrl,
    formatLayerTime,
    buildTileUrlOptions,
} from '../Layers_/tileUrlUtils'
import { resolveTileLayerSource } from '../Layers_/tileLayerSource'
import { MAP_ENGINE } from '../MapEngines/types/engine'

import './TimeControl.css'

// Provider cleanup functions for re-initialization
let _providerCleanups = []

// Can be either hh:mm:ss or just seconds
const relativeTimeFormat = new RegExp(
    /^(-?)(?:2[0-3]|[01]?[0-9]):[0-5][0-9]:[0-5][0-9]$/
)

// `tile` is the configured type for every raster tile layer, on both map
const isTileLayerType = (layer) => layer?.type === 'tile'

var TimeControl = {
    enabled: false,
    isRelative: true,
    currentTime: null,
    timeOffset: '01:00:00',
    startTime: null,
    endTime: null,
    relativeStartTime: '01:00:00',
    relativeEndTime: '00:00:00',
    globalTimeFormat: null,
    _updateLockedForAcceptingInput: false,
    timeUI: null,
    customTimes: {
        times: [],
    },
    init: function () {
        if (L_.configData.time && L_.configData.time.enabled === true) {
            TimeControl.enabled = true
            TimeControl.globalTimeFormat = utcFormat(
                L_.configData.time.format
            )
        } else {
            $('#toggleTimeUI').css({ display: 'none' })
            $('#CoordinatesDiv').css({ marginRight: '0px' })
            return
        }

        TimeControl.timeUI = TimeUI.init(timeInputChange, TimeControl.enabled)

        //updateTime()

        initLayerTimes()
        initLayerDataTimes()
    },
    fina: function () {
        if ((TimeControl.enabled = true && TimeControl.timeUI != null))
            TimeControl.timeUI.fina()

        // Register time providers for mmgisAPI Event Bus
        if (window.mmgisAPI) {
            // Clean up previous providers if re-initializing
            _providerCleanups.forEach((cleanup) => cleanup())
            _providerCleanups = [
                window.mmgisAPI.provide('time:getCurrent', () => TimeControl.getTime()),
                window.mmgisAPI.provide('time:getStart', () => TimeControl.getStartTime()),
                window.mmgisAPI.provide('time:getEnd', () => TimeControl.getEndTime()),
                window.mmgisAPI.provide('time:set', (params) => {
                    if (params) {
                        return TimeControl.setTime(
                            params.startTime,
                            params.endTime,
                            params.isRelative,
                            params.timeOffset,
                            params.currentTime,
                            params.customTimes
                        )
                    }
                    return false
                }),
            ]
        }
    },
    subscribe: function () {},
    unsubscribe: function () {},
    _subscriptions: {},
    subscribe: function (fid, func) {
        if (typeof func === 'function') TimeControl._subscriptions[fid] = func
    },
    unsubscribe: function (fid) {
        if (TimeControl._subscriptions[fid] != null)
            delete TimeControl._subscriptions[fid]
    },
    setTime: function (
        startTime,
        endTime,
        isRelative,
        timeOffset = '00:00:00',
        currentTime,
        customTimes
    ) {
        if (!TimeControl.enabled || startTime == null || endTime == null)
            return false

        if (customTimes != null) {
            if (typeof customTimes === 'string') {
                TimeControl.customTimes.times = [customTimes]
            } else {
                TimeControl.customTimes.times = customTimes
            }
        }

        const now = new Date()
        let offset = 0
        if (relativeTimeFormat.test(timeOffset)) {
            offset = parseTime(timeOffset)
        } else {
            // assume seconds otherwise
            offset = parseInt(timeOffset)
        }
        if (currentTime != null) {
            const currentTimeD = new Date(currentTime)
            TimeControl.currentTime =
                currentTimeD.toISOString().split('.')[0] + 'Z'
            currentTime = new moment(currentTimeD)
        } else {
            currentTime = new moment(now).add(offset, 'seconds')
            TimeControl.currentTime =
                currentTime.toDate().toISOString().split('.')[0] + 'Z'
        }

        if (isRelative == true) {
            const start = parseTime(startTime)
            const end = parseTime(endTime)
            const startTimeM = new moment(currentTime).subtract(
                start,
                'seconds'
            )
            const endTimeM = new moment(currentTime).add(end, 'seconds')

            TimeControl.startTime = startTimeM.toISOString().split('.')[0] + 'Z'
            TimeControl.endTime = endTimeM.toISOString().split('.')[0] + 'Z'
        } else {
            const startTimeD = new Date(startTime)
            const endTimeD = new Date(endTime)
            TimeControl.startTime = startTimeD.toISOString().split('.')[0] + 'Z'
            TimeControl.endTime = endTimeD.toISOString().split('.')[0] + 'Z'
        }

        // Then set startTime one month before end
        if (TimeControl.startTime > TimeControl.endTime) {
            const endTimeD = new Date(endTime)
            TimeControl.startTime =
                new Date(endTimeD.setDate(endTimeD.getDate() - 30))
                    .toISOString()
                    .split('.')[0] + 'Z'
        }

        return TimeControl.timeUI.updateTimes(
            TimeControl.startTime,
            TimeControl.endTime,
            TimeControl.currentTime
        )
    },
    setLayerTime: function (layer, startTime, endTime) {
        if (typeof layer == 'string') {
            layer = L_.asLayerUUID(layer)
            layer = L_.layers.data[layer]
        }
        if (layer.time && layer.time.enabled == true) {
            layer.time.start = startTime
            layer.time.end = endTime
            layer.time.customTimes = TimeControl.customTimes
            $('.starttime.' + F_.getSafeName(layer.name)).text(
                layer.time.start
            )
            $('.endtime.' + F_.getSafeName(layer.name)).text(
                layer.time.end
            )

            if (isTileLayerType(layer)) {
                TimeControl.setLayerWmsParams(layer)
            }
        }
        return true
    },
    getTime: function () {
        return TimeControl.currentTime
    },
    getStartTime: function () {
        return TimeControl.startTime
    },
    getEndTime: function () {
        return TimeControl.endTime
    },
    getLayerStartTime: function (layer) {
        if (typeof layer == 'string') {
            layer = L_.asLayerUUID(layer)
            layer = L_.layers.data[layer]
        }
        if (layer.time) return layer.time.start
        return false
    },
    getLayerEndTime: function (layer) {
        if (typeof layer == 'string') {
            layer = L_.asLayerUUID(layer)
            layer = L_.layers.data[layer]
        }
        if (layer.time) return layer.time.end
        return false
    },
    reloadLayer: async function (
        layer,
        evenIfOff,
        evenIfControlled,
        forceRequery,
        skipOrderedBringToFront
    ) {
        // reload layer
        if (typeof layer == 'string') {
            layer = L_.asLayerUUID(layer)
            layer = L_.layers.data[layer]
        }

        if (L_.layers.layer[layer.name] === null) return false

        const layerTimeFormat = formatLayerTime(layer.time?.format)
        layer.time.current = TimeControl.currentTime // keeps track of when layer was refreshed

        let originalUrl = layer.url

        // A tile layer resolves its source URL first and runs the replacements
        // on the resolved URL, the order layer creation uses. Replacing first
        // would append `nocache=` to the raw config URL, so for a `COG:` layer
        // it would land inside TiTiler's `url=` param instead of on the tile
        // request itself. This also leaves `layer.url` unmutated for tile
        // layers — only the other branches below need the substituted URL.
        const tileSource = isTileLayerType(layer)
            ? resolveTileLayerSource(layer)
            : null

        if (tileSource) {
            tileSource.url = await TimeControl.performTimeUrlReplacements(
                tileSource.url,
                layer,
                forceRequery
            )
        } else {
            layer.url = await TimeControl.performTimeUrlReplacements(
                layer.url,
                layer,
                forceRequery
            )
        }

        if (tileSource) {
            if (layer.time && layer.time.enabled === true) {
                TimeControl.setLayerWmsParams(layer)
            }
            if (evenIfControlled === true || layer.controlled !== true) {
                const tileLayer = L_.layers.layer[layer.name]
                if (L_.layers.on[layer.name] || evenIfOff) {
                    // resolveTileLayerSource is what layer creation uses, so
                    // the refreshed URL keeps the layer's active tile level and
                    // its service prefix handling instead of falling back to
                    // the default source.
                    const { url: resolvedUrl, splitColonType } = tileSource

                    const tileOptions = buildTileUrlOptions(
                        layer,
                        splitColonType
                    )

                    // TODO: Refactor this to push URL compilation and refreshing
                    // into the map engine adapters so TimeControl doesn't branch
                    // on Map_.engine.engineType
                    // https://github.com/NASA-IMPACT/MMGIS/issues/212 tracks this
                    if (tileLayer && typeof tileLayer.refresh === 'function') {
                        // refresh() copies every key onto this.options, which the
                        // per-tile getTileUrl then reads. Safe to pass whole:
                        // buildTileUrlOptions returns only tile-URL keys.
                        // It also re-applies the creation-time URL normalization
                        // ({t} rewriting, the WMS base/params split).
                        tileLayer.refresh(
                            resolvedUrl,
                            forceRequery === true,
                            tileOptions
                        )
                    } else if (Map_.engine?.engineType === MAP_ENGINE.DECKGL) {
                        const newUrl = compileTileUrl(resolvedUrl, tileOptions)
                        Map_.engine.updateLayer(layer.name, { url: newUrl })
                    }
                }
            }
        } else if (layer.type == 'velocity') {
            if (layer.time && layer.time.enabled === true) {
                TimeControl.setLayerWmsParams(layer)
                if (['streamlines', 'particles'].includes(layer.kind)) {
                    const wasOn = L_.layers.on[layer.name]
                    if (wasOn) {
                        L_.toggleLayer(
                            L_.layers.data[layer.name],
                            skipOrderedBringToFront
                        ) // turn off if on
                        L_.toggleLayer(
                            L_.layers.data[layer.name],
                            skipOrderedBringToFront
                        ) // turn back on
                    }
                }
            }
        } else {
            // replace start/endtime keywords
            if (layer.time && layer.time.enabled === true) {
                if (
                    layer.time.type === 'global' ||
                    layer.time.type === 'requery' ||
                    forceRequery
                ) {
                    layer.url = layer.url
                        .replace(
                            /{starttime}/g,
                            layerTimeFormat(layer.time.start)
                        )
                        .replace(
                            /{endtime}/g,
                            layerTimeFormat(layer.time.end)
                        )

                    if (
                        TimeControl.customTimes?.times &&
                        TimeControl.customTimes.times.length > 0
                    ) {
                        for (
                            let i = 0;
                            i < TimeControl.customTimes.times.length;
                            i++
                        ) {
                            layer.url = layer.url.replace(
                                new RegExp(`{customtime.${i}}`, 'g'),
                                TimeControl.customTimes.times[i]
                            )
                        }
                    }
                }
            }
            if (
                layer.type === 'vector' &&
                layer.time.type === 'local' &&
                layer.time.endProp != null &&
                forceRequery !== true
            ) {
                if (evenIfControlled === true || layer.controlled !== true)
                    L_.timeFilterVectorLayer(
                        layer.name,
                        new Date(layer.time.start).getTime(),
                        new Date(layer.time.end).getTime()
                    )
            } else {
                // refresh map
                if (evenIfControlled === true || layer.controlled !== true)
                    if (L_.layers.on[layer.name] || evenIfOff) {
                        return await Map_.refreshLayer(
                            layer,
                            () => {
                                if (layer.time && layer.time.enabled === true) {
                                    // put start/endtime keywords back
                                    layer.url = originalUrl

                                    // if requery was force, remember to timeFilter after load
                                    if (
                                        layer.type === 'vector' &&
                                        layer.time.type === 'local' &&
                                        layer.time.endProp != null &&
                                        forceRequery === true
                                    ) {
                                        if (
                                            evenIfControlled === true ||
                                            layer.controlled !== true
                                        )
                                            L_.timeFilterVectorLayer(
                                                layer.name,
                                                new Date(
                                                    layer.time.start
                                                ).getTime(),
                                                new Date(
                                                    layer.time.end
                                                ).getTime()
                                            )
                                    }
                                }
                            },
                            skipOrderedBringToFront
                        )
                    }
            }
        }
        // put start/endtime keywords back
        if (layer.time && layer.time.enabled === true) layer.url = originalUrl
        return true
    },
    performTimeUrlReplacements: async function (
        url,
        layer,
        forceRequery,
        type
    ) {
        return new Promise(async (resolve, reject) => {
            const layerTimeFormat = formatLayerTime(layer.time?.format)

            let nextUrl = url
            if (layer.variables?.urlReplacements) {
                const keys = Object.keys(layer.variables.urlReplacements)
                for (let i = 0; i < keys.length; i++) {
                    const r = layer.variables.urlReplacements[keys[i]]
                    if (r.on === 'timeChange') {
                        const response = await fetch(r.url, {
                            method: r.type,
                            headers: {
                                accept: 'application/json',
                                'content-type': 'application/json',
                            },
                            body: JSON.stringify(r.body)
                                .replaceAll(
                                    '{starttime}',
                                    layerTimeFormat(layer.time.start)
                                )
                                .replaceAll(
                                    '{endtime}',
                                    layerTimeFormat(layer.time.end)
                                ),
                        })
                        const res = await response.json()
                        const replacement = F_.getIn(res, r.return)
                        if (replacement)
                            nextUrl = nextUrl.replace(
                                `{${keys[i]}}`,
                                encodeURIComponent(replacement)
                            )
                    }
                }
            }

            if (forceRequery === true) {
                nextUrl += `${
                    nextUrl.indexOf('?') === -1 ? '?' : '&'
                }nocache=${new Date().getTime()}`
            }
            resolve(nextUrl)
        })
    },
    reloadTimeLayers: function () {
        // refresh time enabled layers
        let reloadedLayers = []
        let savedActiveFeature = null

        // Save active feature if it belongs to a time-enabled layer
        if (L_.activeFeature) {
            const activeLayerName = L_.activeFeature.layerName
            const activeLayer = L_.layers.data[activeLayerName]

            if (
                activeLayer &&
                activeLayer.time &&
                activeLayer.time.enabled === true
            ) {
                // Save the active feature details for restoration
                savedActiveFeature = {
                    layerName: activeLayerName,
                    feature: JSON.parse(
                        JSON.stringify(L_.activeFeature.feature)
                    ),
                }

                // If the layer has useKeyAsId or useKeyAsName, save the key/value
                const keyProp =
                    activeLayer.variables?.useKeyAsId ||
                    activeLayer.variables?.useKeyAsName
                if (keyProp && L_.activeFeature.feature.properties) {
                    // keyProp might be a path like "properties.id" or just "id"
                    const keyPath = keyProp.includes('.')
                        ? keyProp.split('.')
                        : [keyProp]
                    const keyValue = F_.getIn(
                        L_.activeFeature.feature.properties,
                        keyPath
                    )
                    if (keyValue != null) {
                        savedActiveFeature.key = keyProp
                        savedActiveFeature.value = keyValue
                    }
                }
            }
        }

        for (let layerName in L_.layers.data) {
            const layer = L_.layers.data[layerName]
            if (
                layer.time &&
                layer.time.enabled === true &&
                layer.variables?.dynamicExtent != true
            ) {
                TimeControl.reloadLayer(layer)
                reloadedLayers.push(layer.name)
            }
        }

        // Restore active feature after layers reload
        if (
            savedActiveFeature &&
            reloadedLayers.includes(savedActiveFeature.layerName)
        ) {
            setTimeout(() => {
                // Try to restore using key/value if available
                if (savedActiveFeature.key && savedActiveFeature.value) {
                    L_.selectPoint({
                        layerUUID: savedActiveFeature.layerName,
                        key: savedActiveFeature.key,
                        value: savedActiveFeature.value,
                    })
                } else if (
                    savedActiveFeature.feature.geometry &&
                    savedActiveFeature.feature.geometry.coordinates
                ) {
                    // Fallback to selecting by coordinates
                    const coords =
                        savedActiveFeature.feature.geometry.coordinates
                    let lat, lon
                    if (savedActiveFeature.feature.geometry.type === 'Point') {
                        lon = coords[0]
                        lat = coords[1]
                    } else if (
                        savedActiveFeature.feature.geometry.type ===
                            'LineString' ||
                        savedActiveFeature.feature.geometry.type === 'Polygon'
                    ) {
                        // Get first coordinate or centroid
                        const firstCoord =
                            savedActiveFeature.feature.geometry.type ===
                            'Polygon'
                                ? coords[0][0]
                                : coords[0]
                        lon = firstCoord[0]
                        lat = firstCoord[1]
                    }

                    if (lat != null && lon != null) {
                        L_.selectPoint({
                            layerUUID: savedActiveFeature.layerName,
                            lat: lat,
                            lon: lon,
                        })
                    }
                }
            }, 500)
        }

        // Pan to followed feature after layers reload
        if (TimeUI.followEnabled && TimeUI.followedFeature) {
            // Add a small delay to ensure layers have finished loading
            setTimeout(() => {
                TimeUI.panToFollowedFeature()
            }, 500)
        }

        return reloadedLayers
    },
    updateLayersTime: function () {
        let updatedLayers = []
        for (let layerName in L_.layers.data) {
            const layer = L_.layers.data[layerName]
            if (layer.time && layer.time.enabled === true) {
                layer.time.start = TimeControl.startTime
                layer.time.end = TimeControl.currentTime
                layer.time.customTimes = TimeControl.customTimes
                $('.starttime.' + F_.getSafeName(layer.name)).text(
                    layer.time.start
                )
                $('.endtime.' + F_.getSafeName(layer.name)).text(
                    layer.time.end
                )
                updatedLayers.push(layer.name)
                if (isTileLayerType(layer)) {
                    TimeControl.setLayerWmsParams(layer)
                }
            }
        }
        return updatedLayers
    },
    setLayerTimeStatus: function (layer, color) {
        if (typeof layer == 'string') {
            layer = L_.asLayerUUID(layer)
            layer = L_.layers.data[layer]
        }
        if (layer.time) {
            layer.time.status = color
            $('#timesettings' + F_.getSafeName(layer.name)).css(
                'color',
                layer.time.status
            )
        }
        return true
    },
    setLayersTimeStatus: function (color) {
        var updatedLayers = []
        for (let layerName in L_.layers.data) {
            const layer = L_.layers.data[layerName]
            if (
                layer.time &&
                layer.time.enabled === true &&
                (layer.time.type === 'global' || layer.time.type === 'requery')
            ) {
                TimeControl.setLayerTimeStatus(layer, color)
                updatedLayers.push(layer.name)
            }
        }
        return updatedLayers
    },
    setLayerWmsParams: function (layer) {
        // Shared time formatter (see tileUrlUtils.formatLayerTime).
        const layerTimeFormatter = formatLayerTime(layer.time?.format)
        const l = L_.layers.layer[layer.name]

        // Leaflet-only: `options` is where the per-tile getTileUrl and the WMS
        // substitution read their times from. Deck layers expose `props`
        // instead and get their times baked into the URL by reloadLayer, so the
        // guard skips them rather than growing them an `options` nothing reads.
        if (l != null && isTileLayerType(layer) && l.options != null) {
            l.options.time = layerTimeFormatter(layer.time.end)
            l.options.starttime = layerTimeFormatter(layer.time.start)
            l.options.endtime = layerTimeFormatter(layer.time.end)
        }
    },
}

function initLayerDataTimes() {
    for (let i in L_.layers.dataFlat) {
        const layer = L_.layers.dataFlat[i]
        if (layer.time && layer.time.enabled === true) {
            layer.time.start = L_.FUTURES.startTime
                ? L_.FUTURES.startTime.toISOString().split('.')[0] + 'Z'
                : TimeControl.startTime
            layer.time.end = L_.FUTURES.endTime
                ? L_.FUTURES.endTime.toISOString().split('.')[0] + 'Z'
                : TimeControl.endTime
            layer.time.customTimes = TimeControl.customTimes
        }
    }
}

function initLayerTimes() {
    for (let layerName in L_.layers.data) {
        const layer = L_.layers.data[layerName]
        if (layer.time && layer.time.enabled === true) {
            layer.time.start = L_.FUTURES.startTime
                ? L_.FUTURES.startTime.toISOString().split('.')[0] + 'Z'
                : TimeControl.startTime
            layer.time.end = L_.FUTURES.endTime
                ? L_.FUTURES.endTime.toISOString().split('.')[0] + 'Z'
                : TimeControl.endTime
            layer.time.customTimes = TimeControl.customTimes
            $('.starttime.' + F_.getSafeName(layer.name)).text(
                layer.time.start
            )
            $('.endtime.' + F_.getSafeName(layer.name)).text(
                layer.time.end
            )

            // Make sure to set the WMS parameters for WMS layers,
            // otherwise the first load will not have the WMS parameters
            TimeControl.setLayerWmsParams(layer)
        }
    }
}

function timeInputChange(startTime, endTime, currentTime, skipUpdate) {
    TimeControl.startTime = startTime
    TimeControl.currentTime = currentTime == null ? endTime : currentTime
    TimeControl.endTime = endTime

    if (L_?._timeChangeSubscriptions)
        Object.keys(L_._timeChangeSubscriptions).forEach((k) => {
            L_._timeChangeSubscriptions[k]({ startTime, currentTime, endTime })
        })

    Object.keys(TimeControl._subscriptions).forEach((k) => {
        TimeControl._subscriptions[k]({
            startTime: TimeControl.startTime,
            endTime: TimeControl.endTime,
            currentTime: TimeControl.currentTime,
        })
    })

    if (skipUpdate !== true) {
        // Update layer times and reload
        TimeControl.updateLayersTime()
        TimeControl.reloadTimeLayers()
    }
}

function parseTime(t) {
    if (t.toString().indexOf(':') == -1) {
        return parseInt(t)
    }
    var s = t.split(':')
    var seconds = +s[0].replace('-', '') * 60 * 60 + +s[1] * 60 + +s[2]
    if (t.charAt(0) === '-') {
        seconds = seconds * -1
    }
    return seconds
}

export default TimeControl
