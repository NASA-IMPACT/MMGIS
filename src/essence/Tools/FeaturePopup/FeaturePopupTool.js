/**
 * FeaturePopup plugin — no-UI background plugin.
 *
 * pluginId: 'feature-popup'
 *
 * Shows a map-anchored card when a rendered feature is clicked, for layers
 * whose config switches it on. Runs on the deck.gl engine only: on Leaflet,
 * MMGIS opens a clicked feature through its own per-feature click path, and a
 * card here would duplicate it.
 *
 * Reads, per layer, `variables.featurePopup`:
 *   - enabled     (bool) the opt-in
 *   - title       (str)  heading template; '{prop}' is replaced by that
 *                        property's value. Falls back to useKeyAsName
 *   - properties  (arr)  properties to list, each 'key' or 'key|Label';
 *                        omit to list all
 *   - actions     (arr)  up to two { label, event }
 *   - latitudeProperty / longitudeProperty  (str)  properties holding the
 *                        feature's exact position; when both read as numbers
 *                        the card and pin anchor there
 *
 * Without those, a clicked point anchors to its geometry, re-read from the
 * tiles drawn after each move so the anchor sharpens as the map zooms in.
 *
 * Emits, on a card button press, { feature, layerId, latlng } under:
 *   - <action.event>                    when the configured name carries a
 *                                       namespace, e.g. 'plugin:aoi:analyze'
 *   - plugin:feature-popup:<action.event>  when it does not
 *
 * Listens to:
 *   - map:featureClick    (engine bus; filtered to layers that opted in)
 *   - layers:listChanged  (a layer gained or lost, so re-read the opt-ins)
 *   - map:moveend / layer:viewportLoaded  (re-anchor the card and pin to
 *                                          the clicked point)
 *
 * Requests:
 *   - layers:getAllConfigs / map:getEngineType / map:getZoom
 *   - map:showPopup (resolves with how the card closed) / map:hidePopup
 *   - map:queryRenderedFeatures / map:movePopup  re-anchoring
 *   - map:createLayer / map:removeLayer  a pin on the clicked point, which
 *                                        outlives the card and goes on the
 *                                        next click opening none
 */

import {
    mmgisEmit,
    mmgisForPlugin,
    mmgisGetLayerConfigs,
    mmgisOn,
    mmgisRequest,
} from '../_shared/adapters/mmgisAPI'
import { fillTemplate, getIn } from '../_shared/content/fillTemplate'
import { parseNamingProperties } from '../_shared/content/namingProperty'
import { whenMMGISHandlerReady } from '../_shared/adapters/whenMMGISHandlerReady'

const PLUGIN_ID = 'feature-popup'

/**
 * The engine this plugin does not run on. Compared as the plain string the
 * bus reports, rather than against core's own constant: a plugin reaches core
 * through the event bus alone, and what comes back over it is data.
 */
const LEAFLET = 'leaflet'

const PIN_LAYER_ID = 'feature-popup-pin'

const PIN_WIDTH = 20
const PIN_HEIGHT = 28
// Clearance in pixels between the pin's tip and the point. Zero sets the tip
// on the point itself.
const PIN_LIFT = 0

const FeaturePopupTool = {
    made: false,
    _api: null,
    _cleanups: [],
    _configs: new Map(),
    /** The card this plugin has open, so teardown takes down only its own. */
    _openCard: null,
    /** Guards against an older config read landing after a newer one. */
    _readToken: 0,
    /**
     * The clicked point the card and pin are anchored to:
     * { layerId, feature, key, latlng, zoom, zoomRead, exact }. `key` is the
     * feature's properties in a form that compares across tiles; `zoom` is
     * the zoom whose tiles `latlng` came from, filled in once `zoomRead`
     * settles; `exact` marks a position read from the feature's own
     * properties, which no tile can improve on.
     */
    _point: null,
    /** Guards against an older re-anchor landing after a newer one. */
    _reanchorToken: 0,

    initialize() {
        this.make(null)
    },

    make() {
        // The controller calls initialize() and then make(), and with no panel
        // to render, initialize() is itself a make(). Subscribing twice would
        // ask for two cards per click, the first of which the second closes.
        if (this.made) return
        this._api = mmgisForPlugin(PLUGIN_ID)
        this.made = true

        // The layer providers are registered by Layers_.fina(), which runs
        // once the mission's layers have loaded — well after tools are made.
        // Asking before then rejects, and the plugin would sit inert for the
        // rest of the session. Waiting also gets the engine for free: fina()
        // sets L_.Map_ before it registers, so map:getEngineType can answer
        // by the time this fires.
        this._cleanups.push(
            whenMMGISHandlerReady('layers:getAllConfigs', () =>
                this._readLayerConfigs()
            )
        )

        const subscribe = (event, handler) => {
            this._cleanups.push(mmgisOn(event, handler))
        }
        subscribe('map:featureClick', (info) => this._onFeatureClick(info))
        // A move settles before the tiles for the new view arrive, so the
        // first look may still find the coarser tile; the second comes once
        // the clicked layer's tiles are all in. Views served from cache never
        // report loading, which the first look covers.
        subscribe('map:moveend', () => this._reanchor())
        subscribe('layer:viewportLoaded', (event) => {
            if (event?.layerName === this._point?.layerId) {
                this._reanchor({ settled: true })
            }
        })
        // A mission can gain or lose a layer after load, and with it the
        // popup a layer opted into.
        subscribe('layers:listChanged', () => this._readLayerConfigs())
    },

    destroy() {
        this._cleanups.forEach((fn) => {
            try {
                fn()
            } catch {
                // One bad unsubscribe must not strand the rest subscribed.
            }
        })
        this._cleanups = []
        this._hideOwnCard()
        this._removePin()
        this._configs = new Map()
        this._api = null
        this._readToken += 1
        this.made = false
    },

    /**
     * Read which layers opt in, and which engine is drawing them, before the
     * first click rather than during it: a card shown a tick after the click
     * that asked for it is a card the same click can close.
     *
     * The engine gate turns the plugin off for Leaflet alone. A read that
     * loses a race with a newer one is dropped rather than applied, so a
     * burst of layer changes settles on the last answer.
     */
    _readLayerConfigs() {
        const token = ++this._readToken
        Promise.all([
            mmgisGetLayerConfigs(),
            mmgisRequest('map:getEngineType'),
        ])
            .then(([configs, engineType]) => {
                if (token !== this._readToken) return
                this._configs =
                    engineType === LEAFLET ? new Map() : optedInLayers(configs)
            })
            .catch((err) => {
                if (token !== this._readToken) return
                this._configs = new Map()
                console.warn('[FeaturePopup] could not read layer configs', err)
            })
    },

    _onFeatureClick(info) {
        // A click that opens no card still ends the one showing: empty space,
        // or a feature of a layer that wants no popup. The map library closes
        // its own popup on any map click, which covers this today, but the
        // rule that a card never outlives its feature belongs to the plugin
        // rather than to a library default nothing here pins.
        if (!info?.feature) {
            this._hideOwnCard()
            this._removePin()
            return
        }
        const config = this._configs.get(info.layerId)
        if (!config) {
            this._hideOwnCard()
            this._removePin()
            return
        }

        const properties = info.feature.properties || {}
        const title = cardTitle(properties, config)
        const html = propertyTable(properties, config.popup.properties)
        // The service refuses a card with neither, and leaves the open one in
        // place when it does. Take ours down instead, so a card never outlives
        // the feature it describes.
        if (title == null && html == null) {
            this._hideOwnCard()
            this._removePin()
            return
        }

        const exactLatLng = propertyLatLng(properties, config.popup)
        const latlng = exactLatLng ?? cardAnchor(info.feature, info.latlng)

        // Points only. A polygon or line from a vector tile layer arrives
        // clipped to the tile that was clicked, so redrawing it outlines a
        // fragment cut off at the tile edge rather than the whole feature.
        let point = null
        if (isPointFeature(info.feature)) {
            point = {
                layerId: info.layerId,
                feature: info.feature,
                key: stableStringify(properties),
                latlng,
                zoom: null,
                exact: exactLatLng != null,
            }
            point.zoomRead = point.exact
                ? null
                : mmgisRequest('map:getZoom')
                      .then((zoom) => {
                          point.zoom = zoom
                      })
                      .catch(() => {})
            this._setPoint(point)
            this._showPin(pinFeature(point))
        } else {
            this._removePin()
        }

        const actions = config.actions
        const card = {}
        this._openCard = card
        mmgisRequest('map:showPopup', {
                latlng,
                title,
                html,
                // Labels only: the card is data, and the press comes back as
                // the request's answer rather than through a handler.
                primaryAction: actions[0] && { label: actions[0].label },
                secondaryAction: actions[1] && { label: actions[1].label },
        })
            // Two-arg `then`, so a throw out of the emit is not reported as a
            // failure to show the card.
            .then(
                (result) => {
                    if (this._openCard === card) this._openCard = null
                    // Null is the wrapper reporting no bus at all, which is
                    // not an outcome the card reached.
                    const action = result?.action
                    const pressed =
                        action === 'primary'
                            ? actions[0]
                            : action === 'secondary'
                              ? actions[1]
                              : null
                    // 'dismiss' and 'closed' are the card going away, which
                    // says nothing about the feature.
                    if (!pressed) return
                    this._emitAction(pressed.event, {
                        feature: info.feature,
                        layerId: info.layerId,
                        // Re-anchoring moves the point it holds, so the
                        // action carries where the card points now.
                        latlng: point?.latlng ?? latlng,
                    })
                },
                (err) => {
                    if (this._openCard === card) this._openCard = null
                    console.warn('[FeaturePopup] showPopup failed', err)
                }
            )
    },

    /**
     * Send an action's event, as a mission addressed it.
     *
     * A name carrying a namespace is another plugin's — or core's — and goes
     * out exactly as written, the way a configured action string is resolved
     * everywhere else. A bare name is this plugin's own event and is emitted
     * under its address, so a mission wiring up its own listener does not
     * have to spell the prefix out.
     */
    _emitAction(event, payload) {
        if (event.includes(':')) {
            mmgisEmit(event, payload)
            return
        }
        this._api?.emit(event, payload)
    },

    /**
     * Take down the card this plugin opened. The popup is one global slot, so
     * hiding unconditionally would close whatever another plugin is showing.
     */
    _hideOwnCard() {
        if (!this._openCard) return
        this._openCard = null
        mmgisRequest('map:hidePopup').catch(() => {})
    },

    // An icon, so deck.gl billboards it: the pin stays upright and facing
    // the camera when the map is pitched, where a circle would lie flat.
    _showPin(feature) {
        mmgisRequest('map:createLayer', {
            id: PIN_LAYER_ID,
            type: 'vector',
            geojson: { type: 'FeatureCollection', features: [feature] },
            // Click-transparent, so the next click reaches the feature under it.
            interactive: false,
            variables: {
                markerIcon: {
                    iconUrl: pinIconUrl(
                        themeToken('--theme-color-primary', '#1c67e3')
                    ),
                    iconSize: [PIN_WIDTH, PIN_HEIGHT],
                    // Bottom center, so the tip marks the point.
                    iconAnchor: [PIN_WIDTH / 2, PIN_HEIGHT + PIN_LIFT],
                },
            },
        }).catch((err) =>
            console.warn('[FeaturePopup] could not pin the feature', err)
        )
    },

    _removePin() {
        this._setPoint(null)
        mmgisRequest('map:removeLayer', { id: PIN_LAYER_ID }).catch(() => {})
    },

    /** Replacing the point drops any re-anchor still under way for the old one. */
    _setPoint(point) {
        this._point = point
        this._reanchorToken += 1
    },

    /**
     * Move the card and pin onto the clicked point as the map now draws it.
     *
     * A vector tile snaps positions to a grid that coarsens at lower zooms,
     * so a point read zoomed out drifts from its true spot as the map zooms
     * in. The point is looked up again in the tiles drawn now, matched to the
     * clicked feature, and the anchor takes the finer position.
     *
     * `point.zoom` is the zoom whose tiles the anchor is known to come from.
     * A move that does not zoom past it has nothing finer to offer and is
     * skipped. A `settled` look comes once every tile in view has loaded, so
     * its answer carries this zoom's precision and becomes the new bound; a
     * look straight after a move may still read a coarser stand-in tile, so
     * it never moves the bound.
     */
    async _reanchor({ settled = false } = {}) {
        const point = this._point
        if (!point || point.exact) return
        const token = ++this._reanchorToken
        const stale = () => token !== this._reanchorToken
        try {
            const [, zoom] = await Promise.all([
                point.zoomRead,
                mmgisRequest('map:getZoom'),
            ])
            if (stale()) return
            const gained =
                Number.isFinite(zoom) && Number.isFinite(point.zoom)
                    ? zoom - point.zoom
                    : 0
            if (!settled && gained <= 0) return
            const results = await mmgisRequest('map:queryRenderedFeatures', {
                latlng: point.latlng,
                radius: reanchorRadius(Math.max(0, gained)),
                layers: [point.layerId],
            })
            if (stale()) return
            const match = closestMatch(results, point)
            if (!match) return
            if (settled && Number.isFinite(zoom)) point.zoom = zoom
            if (sqDist(match.latlng, point.latlng) === 0) return
            point.latlng = match.latlng
            point.feature = match.feature
            if (this._openCard) {
                mmgisRequest('map:movePopup', { latlng: point.latlng }).catch(
                    () => {}
                )
            }
            this._showPin(pinFeature(point))
        } catch (err) {
            console.warn('[FeaturePopup] could not re-anchor the card', err)
        }
    },
}

/**
 * The position a layer says its features carry in their own properties, as
 * configured by `latitudeProperty` and `longitudeProperty`. Exact where a
 * tile's geometry is snapped, so it wins whenever both read as numbers in
 * range. Numeric strings count: CSV-derived data often stores them so.
 */
function propertyLatLng(properties, popup) {
    const latKey = popup?.latitudeProperty
    const lngKey = popup?.longitudeProperty
    if (!isNonBlank(latKey) || !isNonBlank(lngKey)) return null
    const lat = toCoordinate(readProperty(properties, latKey.trim()))
    const lng = toCoordinate(readProperty(properties, lngKey.trim()))
    if (lat == null || lng == null) return null
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    return { lat, lng }
}

function toCoordinate(value) {
    if (typeof value !== 'number' && !isNonBlank(value)) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * What the pin draws. A single point is drawn at the anchor, so pin and card
 * always agree; a multipoint keeps its members, as last read from the map.
 */
function pinFeature(point) {
    const geometry =
        point.feature.geometry?.type === 'Point'
            ? { type: 'Point', coordinates: [point.latlng.lng, point.latlng.lat] }
            : point.feature.geometry
    return { ...point.feature, geometry }
}

// Pixels searched around the anchor when re-anchoring: a floor for the
// rendered marker's own size, plus the snapping error grown by the zoom
// gained. A 512px tile's grid cell is 1/8px at its own zoom, so a quarter
// pixel per doubling covers it with room to spare.
const REANCHOR_BASE_RADIUS = 6
const REANCHOR_MAX_RADIUS = 256

function reanchorRadius(zoomGained) {
    const grown = REANCHOR_BASE_RADIUS + 0.25 * 2 ** zoomGained
    return Math.min(REANCHOR_MAX_RADIUS, Math.ceil(grown))
}

/**
 * Among the features found around the anchor, the one that is the clicked
 * feature, with its position as now drawn. Several may match: a tile's
 * buffer repeats a feature near its edge in the neighbouring tile. The match
 * nearest the current anchor wins.
 */
function closestMatch(results, point) {
    const matches = (Array.isArray(results) ? results : [])
        .map((result) => result?.feature)
        .filter((feature) => feature && isClickedFeature(feature, point))
        .map((feature) => ({ feature, latlng: cardAnchor(feature, point.latlng) }))
    if (matches.length === 0) return null
    return matches.reduce((best, match) =>
        sqDist(match.latlng, point.latlng) < sqDist(best.latlng, point.latlng)
            ? match
            : best
    )
}

/**
 * Whether a pick is the clicked feature. Tiles at different zooms are
 * separate decodes, so object identity says nothing: compare the feature id
 * when both carry one, and otherwise the properties, key order aside.
 */
function isClickedFeature(feature, point) {
    if (feature.id != null && point.feature.id != null) {
        return feature.id === point.feature.id
    }
    return stableStringify(feature.properties || {}) === point.key
}

function stableStringify(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`
}

function isPointFeature(feature) {
    const type = feature?.geometry?.type
    return type === 'Point' || type === 'MultiPoint'
}

/**
 * Where the card points. The click location is anywhere inside the rendered
 * marker, so a card anchored there drifts off a point as the map zooms in; a
 * point feature anchors to its own coordinate instead, and a multipoint to the
 * member nearest the click. Lines and polygons have no single spot to point
 * at, so they keep the click.
 *
 * The picked geometry is lng/lat for vector tiles as well as GeoJSON: deck.gl's
 * MVTLayer converts a picked feature out of tile-local space before handing it
 * over.
 */
function cardAnchor(feature, clickLatLng) {
    const geometry = feature?.geometry
    const toLatLng = (coord) =>
        Array.isArray(coord) &&
        Number.isFinite(coord[0]) &&
        Number.isFinite(coord[1])
            ? { lat: coord[1], lng: coord[0] }
            : null

    if (geometry?.type === 'Point') {
        return toLatLng(geometry.coordinates) ?? clickLatLng
    }
    if (geometry?.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
        const members = geometry.coordinates.map(toLatLng).filter(Boolean)
        if (members.length === 0) return clickLatLng
        if (!clickLatLng) return members[0]
        return members.reduce((best, p) =>
            sqDist(p, clickLatLng) < sqDist(best, clickLatLng) ? p : best
        )
    }
    return clickLatLng
}

/** Squared distance in degrees: enough to rank nearby candidates. */
function sqDist(a, b) {
    return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2
}

function themeToken(name, fallback) {
    if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
    const value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim()
    return value || fallback
}

/**
 * A location pin in the theme's primary color. The white stroke keeps it
 * legible on both dark and light basemaps.
 */
function pinIconUrl(color) {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 24 32">` +
        `<path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
        `<circle cx="12" cy="12" r="4" fill="#ffffff"/>` +
        `</svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * The actions a layer declares, capped at the two slots the card has. A
 * declaration needs both a label to show and an event to emit; a half-filled
 * row would render a button that does nothing, or emit an event with no name.
 */
function resolveActions(actions, layerId) {
    const declared = Array.isArray(actions) ? actions : []
    const usable = declared.filter(
        (action) => isNonBlank(action?.label) && isNonBlank(action?.event)
    )
    if (usable.length < declared.length) {
        console.warn(
            `[FeaturePopup] Layer "${layerId}" declares ${
                declared.length - usable.length
            } popup action(s) missing a label or an event name; they are ignored.`
        )
    }
    if (usable.length > 2) {
        console.warn(
            `[FeaturePopup] Layer "${layerId}" declares ${usable.length} popup ` +
                `actions; a card holds two, so the rest are ignored.`
        )
    }
    return usable.slice(0, 2).map((action) => ({
        label: action.label,
        event: action.event.trim(),
    }))
}

function isNonBlank(value) {
    return typeof value === 'string' && value.trim() !== ''
}

/**
 * The card's heading. The configured title is a template in the form missions
 * already write External Links and TopBar Information in: text as written,
 * with every `{prop}` replaced by that property's value. A template resolving
 * to nothing leaves the card headingless rather than blank-headed.
 *
 * With no title configured, fall back to the property the layer already names
 * its features by, which the rest of MMGIS reads as a string or as a list of
 * candidates.
 */
function cardTitle(properties, config) {
    const template = config.popup.title
    if (isNonBlank(template)) {
        const filled = fillTemplate(template, properties).trim()
        return filled === '' ? undefined : filled
    }
    const key = parseNamingProperties(config.useKeyAsName)[0]?.prop
    if (key == null) return undefined
    // The service takes a string and refuses anything else, so a layer named
    // by a number — an id, a sol — would otherwise cost the card entirely.
    // Blank reads the same as unnamed rather than as an empty heading.
    const namedValue = properties[key]
    const text = namedValue == null ? '' : String(namedValue)
    return isNonBlank(text) ? text : undefined
}

/**
 * The card body: one row per property, in the order the layer configured,
 * headed by its display label. An unconfigured `keys` shows everything the
 * feature carries, each under its own key.
 *
 * Keys and values are escaped rather than trusted. Core sanitizes what it is
 * handed, which stops a script from running but not a value holding `<` from
 * swallowing the rest of the row.
 */
function propertyTable(properties, keys) {
    // Configure stores this list by splitting on commas and nothing else, so
    // 'depth_m, sample_class' arrives with the space still attached; the
    // parser trims it, along with the space around a label's pipe.
    const shown = Array.isArray(keys)
        ? parseNamingProperties(keys.map((key) => (key == null ? key : String(key))))
        : Object.keys(properties).map((key) => ({ prop: key, label: key }))
    const rows = shown
        // A property the feature does not carry, and one carrying no value,
        // both have nothing to show; a row reading 'null' is noise.
        .filter(({ prop }) => readProperty(properties, prop) != null)
        .map(
            ({ prop, label }) =>
                `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(
                    formatValue(readProperty(properties, prop))
                )}</td></tr>`
        )
    return rows.length ? `<table>${rows.join('')}</table>` : undefined
}

/**
 * A configured key names a property directly, or reaches a nested one by the
 * same dot path the heading template accepts. Its own name wins over the path
 * reading, so a feature genuinely carrying a key with a dot in it still shows.
 */
function readProperty(properties, key) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
        return properties[key]
    }
    return getIn(properties, key)
}

/** A nested value would otherwise reach the card as '[object Object]'. */
function formatValue(value) {
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return String(value)
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * The layers whose config switches the popup on, keyed by layer id, each
 * alongside the property the layer already names its features by.
 *
 * The switch has to be on, not merely present: the Configure page writes only
 * the fields an admin touches, so a block can exist because someone filled in
 * a heading and left the switch alone.
 */
function optedInLayers(configs) {
    const opted = new Map()
    Object.entries(configs || {}).forEach(([id, layer]) => {
        const popup = layer?.variables?.featurePopup
        if (popup && popup.enabled === true) {
            opted.set(id, {
                popup,
                useKeyAsName: layer.variables.useKeyAsName,
                actions: resolveActions(popup.actions, id),
            })
        }
    })
    return opted
}

export default FeaturePopupTool
