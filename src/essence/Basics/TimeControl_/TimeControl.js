// TimeControl sets up a div that displays the time controller
import { utcFormat } from 'd3-time-format'
import * as moment from 'moment'
import $ from 'jquery'
import F_ from '../Formulae_/Formulae_'
import L_ from '../Layers_/Layers_'
import Map_ from '../Map_/Map_'
import { parseTimeWithOffset, parseTimeToSeconds } from './timeUtils'
import {
    compileTileUrl,
    formatLayerTime,
    buildTileUrlOptions,
    shouldUseDeckRaster,
} from '../Layers_/tileUrlUtils'
import {
    resolveTileLayerSource,
    resolveDeckCOGFileUrl,
} from '../Layers_/tileLayerSource'
import { MAP_ENGINE, isRasterTileLayerType } from '../MapEngines/types/engine'

import './TimeControl.css'

// Provider cleanup functions for re-initialization
let _providerCleanups = []

// Can be either hh:mm:ss or just seconds
const relativeTimeFormat = new RegExp(
    /^(-?)(?:2[0-3]|[01]?[0-9]):[0-5][0-9]:[0-5][0-9]$/
)

// A mission's time.format is written in one of two languages: d3 time-format
// (e.g. '%Y-%m-%dT%H:%M:%SZ'), marked by a '%', or moment tokens (e.g.
// 'YYYY-MM-DDTHH:mm:ss[Z]') as used elsewhere in the app (TimeUI.js,
// DrawTool_Templater.js's default). Falls back to this when a mission has
// time enabled but never configured a format.
const DEFAULT_TIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss[Z]'

// Formats a time through the mission's configured time.format, choosing the
// formatter that matches the language the format string is written in. Any
// failure falls back to the default so a malformed format string can't break
// a caller (e.g. an export stamping the time onto a legend).
const formatMissionTime = (time) => {
    const format = L_.configData.time?.format || DEFAULT_TIME_FORMAT
    try {
        return format.includes('%')
            ? utcFormat(format)(new Date(time))
            : moment.utc(time).format(format)
    } catch (err) {
        console.warn(
            `Invalid 'Time Format' provided. Defaulting to ${DEFAULT_TIME_FORMAT}.`,
            err
        )
        return moment.utc(time).format(DEFAULT_TIME_FORMAT)
    }
}

var TimeControl = {
    enabled: false,
    isRelative: true,
    currentTime: null,
    timeOffset: '01:00:00',
    startTime: null,
    endTime: null,
    relativeStartTime: '01:00:00',
    relativeEndTime: '00:00:00',
    _updateLockedForAcceptingInput: false,
    customTimes: {
        times: [],
    },
    init: function () {
        // Clear any cleanups left over from a prior lifecycle so re-init
        // (e.g. mission swap) can't accumulate stale providers/listeners.
        _providerCleanups.forEach((cleanup) => cleanup())
        _providerCleanups = []

        // Register bus handlers before any UI or plugin can emit, so a
        // time:changeRequested is never lost to registration order.
        if (window.mmgisAPI) {
            _providerCleanups = [
                window.mmgisAPI.on(
                    'time:changeRequested',
                    ({ startTime, endTime, currentTime }) => {
                        if (TimeControl.enabled)
                            timeInputChange(startTime, endTime, currentTime)
                    }
                ),
                // Separates "time is off for this mission" from "on but not yet
                // seeded"; the getters below return null for both.
                window.mmgisAPI.provide('time:isEnabled', () => TimeControl.enabled === true),
                window.mmgisAPI.provide('time:getCurrent', () => TimeControl.getTime()),
                // Same current time as time:getCurrent, but through the
                // mission's time.format (d3 or moment style) rather than raw
                // ISO — null whenever time isn't enabled or not yet seeded,
                // matching time:isEnabled/getCurrent's own null-until-ready
                // convention.
                window.mmgisAPI.provide('time:getCurrentFormatted', () =>
                    TimeControl.enabled && TimeControl.currentTime != null
                        ? formatMissionTime(TimeControl.currentTime)
                        : null
                ),
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

        if (L_.configData.time && L_.configData.time.enabled === true) {
            TimeControl.enabled = true
        } else {
            TimeControl.enabled = false
            return
        }

        // Derive the initial start/end times. TimeControl owns this state
        // and widgets (e.g. TimeUI) read the committed values from it.
        // Deeplinked times (L_.FUTURES) override the configured ones and
        // both support the "<date> + <seconds>"/"<date> - <seconds>" format.
        const rawEnd =
            L_.FUTURES.endTime != null
                ? L_.FUTURES.endTime
                : L_.configData.time.initialend
        // parseTimeWithOffset strips any " + N"/" - N" suffix, so compare the
        // parsed dateString (not the raw value) against 'now' — "now - 86400"
        // is a valid relative time, not an invalid date.
        let dateAddSec = parseTimeWithOffset(rawEnd)
        let initialEnd
        if (dateAddSec.dateString != null && dateAddSec.dateString !== 'now') {
            const dateStaged = new Date(dateAddSec.dateString)
            if (isNaN(dateStaged.getTime())) {
                initialEnd = new Date()
                console.warn(
                    "Invalid 'Initial End Time' provided. Defaulting to 'now'."
                )
            } else initialEnd = dateStaged
        } else initialEnd = new Date()
        initialEnd.setSeconds(
            initialEnd.getSeconds() + dateAddSec.additionalSeconds
        )

        // Initial start defaults to 1 month before the end time
        let initialStart = new Date(initialEnd)
        const rawStart =
            L_.FUTURES.startTime != null
                ? L_.FUTURES.startTime
                : L_.configData.time.initialstart
        if (rawStart == null)
            initialStart.setUTCMonth(initialStart.getUTCMonth() - 1)
        else {
            dateAddSec = parseTimeWithOffset(rawStart)
            // 'now' (optionally with an offset, e.g. "now - 86400") is valid
            const dateStaged =
                dateAddSec.dateString === 'now'
                    ? new Date()
                    : new Date(dateAddSec.dateString)
            if (isNaN(dateStaged.getTime())) {
                initialStart.setUTCMonth(initialStart.getUTCMonth() - 1)
                console.warn(
                    "Invalid 'Initial Start Time' provided. Defaulting to 1 month before the end time."
                )
            } else {
                dateStaged.setSeconds(
                    dateStaged.getSeconds() + dateAddSec.additionalSeconds
                )
                if (dateStaged.getTime() > initialEnd.getTime()) {
                    initialStart.setUTCMonth(initialStart.getUTCMonth() - 1)
                    console.warn(
                        "'Initial Start Time' cannot be later than the end time. Defaulting to 1 month before the end time."
                    )
                } else initialStart = dateStaged
            }
        }

        // Seed TimeControl state (start/end/current) and notify subscribers.
        // Do NOT reload here: Map_.init() runs after TimeControl.init(), so
        // time-enabled layers aren't on the map yet — reloading now is a no-op.
        timeInputChange(
            initialStart.toISOString(),
            initialEnd.toISOString(),
            initialEnd.toISOString(),
            true
        )

        // Layer times read the seeded TimeControl state, so this must run
        // after timeInputChange — otherwise the first Map_ load would build
        // tile/WMS requests with null times.
        initLayerTimes()
        initLayerDataTimes()
    },
    fina: function () {
        // Runs after Map_.init() has loaded the time-enabled layers (the
        // seed in init() skips reloading because they aren't on the map yet).
        // This is the single initial reload, in every layout; widgets mirror
        // the committed state via the time:changed broadcast.
        if (TimeControl.enabled) {
            timeInputChange(
                TimeControl.startTime,
                TimeControl.endTime,
                TimeControl.currentTime
            )
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
            offset = parseTimeToSeconds(timeOffset)
        } else {
            // assume seconds otherwise
            offset = parseInt(timeOffset)
        }
        if (currentTime != null) {
            const currentTimeD = new Date(currentTime)
            if (isNaN(currentTimeD.getTime())) {
                console.warn(
                    `TimeControl.setTime: Invalid currentTime '${currentTime}'.`
                )
                return false
            }
            TimeControl.currentTime =
                currentTimeD.toISOString().split('.')[0] + 'Z'
            currentTime = new moment(currentTimeD)
        } else {
            currentTime = new moment(now).add(offset, 'seconds')
            TimeControl.currentTime =
                currentTime.toDate().toISOString().split('.')[0] + 'Z'
        }

        if (isRelative == true) {
            const start = parseTimeToSeconds(startTime)
            const end = parseTimeToSeconds(endTime)
            if (isNaN(start) || isNaN(end)) {
                console.warn(
                    `TimeControl.setTime: Invalid relative startTime '${startTime}' or endTime '${endTime}'.`
                )
                return false
            }
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
            if (isNaN(startTimeD.getTime()) || isNaN(endTimeD.getTime())) {
                console.warn(
                    `TimeControl.setTime: Invalid startTime '${startTime}' or endTime '${endTime}'.`
                )
                return false
            }
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

        // Commit directly — a programmatic time change must never depend on
        // a UI being present. timeInputChange broadcasts 'time:changed' for
        // widgets/plugins (e.g. TimeUI) to sync themselves against.
        timeInputChange(
            TimeControl.startTime,
            TimeControl.endTime,
            TimeControl.currentTime
        )

        return true
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

            if (isRasterTileLayerType(layer)) {
                TimeControl.setLayerWmsParams(layer)
            }
        }
        return true
    },
    // Toggles the visibility of the bottom TimeUI bar. The '#toggleTimeUI'
    // button and its click behavior are owned by Coordinates, so delegate to
    // the button instead of duplicating the show/hide logic here.
    // mmgisAPI.toggleTimeUI exposes this publicly.
    toggleTimeUI: function (force) {
        const button = $('#toggleTimeUI')
        if (button.length === 0) return false
        const isActive = button.hasClass('active')
        const targetActive = force != null ? force === true : !isActive
        if (targetActive !== isActive) button.trigger('click')
        return button.hasClass('active')
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

        // A raster tile layer resolves its source URL first and runs the
        // replacements on the resolved URL, the order layer creation uses.
        // Replacing first would append `nocache=` to the raw config URL, so for
        // a `COG:` layer it would land inside TiTiler's `url=` param instead of
        // on the tile request itself. This also leaves `layer.url` unmutated for
        // tile layers — only the other branches below need the substituted URL.
        //
        // Deliberately raster-only. Map_ also builds Tile3DLayer and
        // PointCloudLayer through makeTileLayer, so they resolve their URL
        // differently here than at creation and never get `{time}` substituted.
        // Widening this needs the raster-specific tile params (TMS, COG/STAC)
        // made opt-in first — see issue #230.
        const tileSource = isRasterTileLayerType(layer)
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
                    const {
                        url: resolvedUrl,
                        splitColonType,
                        tileFormat,
                    } = tileSource

                    const tileOptions = buildTileUrlOptions(
                        layer,
                        splitColonType,
                        tileFormat
                    )

                    // TODO: Refactor this to push URL compilation and refreshing
                    // into the map engine adapters so TimeControl doesn't branch
                    // on Map_.engine.engineType
                    // https://github.com/NASA-IMPACT/MMGIS/issues/212 tracks this
                    if (
                        shouldUseDeckRaster(
                            Map_.engine?.engineType,
                            splitColonType,
                            layer
                        )
                    ) {
                        // The client-side COG renderer reads the file directly —
                        // the compiled TiTiler tiles URL above is meaningless to
                        // it, and updateLayer({url}) would be silently ignored
                        // (COGLayer is keyed on its `geotiff` prop). Rebuild
                        // from the time-substituted file URL so deck.gl swaps
                        // the layer in place by id.
                        L_.rebuildDeckCOGLayer(
                            layer,
                            resolveDeckCOGFileUrl(layer, tileSource)
                        )
                    } else if (
                        tileLayer &&
                        typeof tileLayer.refresh === 'function'
                    ) {
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
                layer.variables?.dynamicExtent !== true
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

        // Emit event for TimeUI to handle follow feature
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('time:layersReloaded', {
                reloadedLayers: reloadedLayers,
            })
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
                if (isRasterTileLayerType(layer)) {
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
        if (l != null && isRasterTileLayerType(layer) && l.options != null) {
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

    // Emit event for external listeners via Event Bus
    if (window.mmgisAPI) {
        window.mmgisAPI.emit('time:changed', {
            startTime: TimeControl.startTime,
            endTime: TimeControl.endTime,
            currentTime: TimeControl.currentTime,
        })
    }

    // Keep existing subscriptions for backward compatibility
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

export default TimeControl
