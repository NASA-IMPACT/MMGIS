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
 *
 * Emits, on a card button press, { feature, layerId, latlng } under:
 *   - <action.event>                    when the configured name carries a
 *                                       namespace, e.g. 'plugin:aoi:analyze'
 *   - plugin:feature-popup:<action.event>  when it does not
 *
 * Listens to:
 *   - map:featureClick    (engine bus; filtered to layers that opted in)
 *   - layers:listChanged  (a layer gained or lost, so re-read the opt-ins)
 *
 * Requests:
 *   - layers:getAllConfigs / map:getEngineType
 *   - map:showPopup (resolves with how the card closed) / map:hidePopup
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

const FeaturePopupTool = {
    made: false,
    _api: null,
    _cleanups: [],
    _configs: new Map(),
    /** The card this plugin has open, so teardown takes down only its own. */
    _openCard: null,
    /** Guards against an older config read landing after a newer one. */
    _readToken: 0,

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
            return
        }
        const config = this._configs.get(info.layerId)
        if (!config) {
            this._hideOwnCard()
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
            return
        }

        const actions = config.actions
        const card = {}
        this._openCard = card
        mmgisRequest('map:showPopup', {
                latlng: info.latlng,
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
                        latlng: info.latlng,
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
