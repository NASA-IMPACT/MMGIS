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
 *   - properties  (arr)  property keys to list; omit to list all
 *   - actions     (arr)  up to two { label, event }
 *
 * Emits (auto-prefixed plugin:feature-popup:):
 *   - <action.event>   { feature, layerId, latlng }   — on a card button press
 *
 * Listens to:
 *   - map:featureClick    (engine bus; filtered to layers that opted in)
 *   - layers:listChanged  (a layer gained or lost, so re-read the opt-ins)
 *
 * Requests:
 *   - layers:getAllConfigs / map:getEngineType
 *   - map:showPopup (resolves with how the card closed) / map:hidePopup
 */

import F_ from '../../Basics/Formulae_/Formulae_'
import { MAP_ENGINE } from '../../Basics/MapEngines/types/engine'
import { whenMMGISHandlerReady } from '../_shared/adapters/whenMMGISHandlerReady'

const PLUGIN_ID = 'feature-popup'

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
        const api = window.mmgisAPI
        if (!api?.on) return
        this._api = api.forPlugin(PLUGIN_ID)
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
            const off = api.on(event, handler)
            this._cleanups.push(typeof off === 'function' ? off : () => {})
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
        const api = window.mmgisAPI
        const token = ++this._readToken
        Promise.all([
            api.request('layers:getAllConfigs'),
            api.request('map:getEngineType'),
        ])
            .then(([configs, engineType]) => {
                if (token !== this._readToken) return
                this._configs =
                    engineType === MAP_ENGINE.LEAFLET
                        ? new Map()
                        : optedInLayers(configs)
            })
            .catch((err) => {
                if (token !== this._readToken) return
                this._configs = new Map()
                console.warn('[FeaturePopup] could not read layer configs', err)
            })
    },

    _onFeatureClick(info) {
        if (!info?.feature) return
        const config = this._configs.get(info.layerId)
        if (!config) return

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
        window.mmgisAPI
            .request('map:showPopup', {
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
                ({ action } = {}) => {
                    if (this._openCard === card) this._openCard = null
                    const pressed =
                        action === 'primary'
                            ? actions[0]
                            : action === 'secondary'
                              ? actions[1]
                              : null
                    // 'dismiss' and 'closed' are the card going away, which
                    // says nothing about the feature.
                    if (!pressed) return
                    this._api?.emit(pressed.event, {
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
     * Take down the card this plugin opened. The popup is one global slot, so
     * hiding unconditionally would close whatever another plugin is showing.
     */
    _hideOwnCard() {
        if (!this._openCard) return
        this._openCard = null
        window.mmgisAPI?.request?.('map:hidePopup').catch(() => {})
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
 * The card's heading. The configured title is a template in the form External
 * Links and TopBar Information already use: text as written, with every
 * `{prop}` replaced by that property's value. A template resolving to nothing
 * leaves the card headingless rather than blank-headed.
 *
 * With no title configured, fall back to the property the layer already names
 * its features by, which the rest of MMGIS reads as a string or as a list of
 * candidates.
 */
function cardTitle(properties, config) {
    const template = config.popup.title
    if (isNonBlank(template)) {
        const filled = F_.bracketReplace(template, properties).trim()
        return filled === '' ? undefined : filled
    }
    const named = config.useKeyAsName
    const key = Array.isArray(named) ? named[0] : named
    if (key == null) return undefined
    const value = properties[key]
    return value == null ? undefined : value
}

/**
 * The card body: one row per property, in the order the layer configured. An
 * unconfigured `keys` shows everything the feature carries.
 *
 * Keys and values are escaped rather than trusted. Core sanitizes what it is
 * handed, which stops a script from running but not a value holding `<` from
 * swallowing the rest of the row.
 */
function propertyTable(properties, keys) {
    const shown = Array.isArray(keys) ? keys : Object.keys(properties)
    const rows = shown
        // A property the feature does not carry, and one carrying no value,
        // both have nothing to show; a row reading 'null' is noise.
        .filter((key) => properties[key] != null)
        .map(
            (key) =>
                `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(
                    formatValue(properties[key])
                )}</td></tr>`
        )
    return rows.length ? `<table>${rows.join('')}</table>` : undefined
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
