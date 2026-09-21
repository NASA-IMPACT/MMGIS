import F_ from '../../Basics/Formulae_/Formulae_'
import { MAP_ENGINE } from '../../Basics/MapEngines/types/engine'

const PLUGIN_ID = 'feature-popup'

const FeaturePopupTool = {
    made: false,
    _api: null,
    _cleanups: [],
    _configs: new Map(),

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

        this._readLayerConfigs()

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
        this._cleanups.forEach((fn) => fn())
        this._cleanups = []
        window.mmgisAPI?.request?.('map:hidePopup').catch(() => {})
        this._configs = new Map()
        this._api = null
        this.made = false
    },

    /**
     * Read which layers opt in, and which engine is drawing them, before the
     * first click rather than during it: a card shown a tick after the click
     * that asked for it is a card the same click can close.
     *
     * The engine gate turns the plugin off for Leaflet alone, where MMGIS
     * already opens features through its own per-feature click path. An engine
     * that has not answered yet leaves the plugin on — the alternative is
     * silence on deck.gl whenever the plugin loads first.
     */
    _readLayerConfigs() {
        const api = window.mmgisAPI
        Promise.all([
            api.request('layers:getAllConfigs'),
            api.request('map:getEngineType'),
        ])
            .then(([configs, engineType]) => {
                this._configs =
                    engineType === MAP_ENGINE.LEAFLET
                        ? new Map()
                        : optedInLayers(configs)
            })
            .catch((err) => {
                this._configs = new Map()
                console.warn('[FeaturePopup] could not read layer configs', err)
            })
    },

    _onFeatureClick(info) {
        if (!info?.feature) return
        const config = this._configs.get(info.layerId)
        if (!config) return

        const properties = info.feature.properties || {}
        const actions = config.actions
        window.mmgisAPI
            .request('map:showPopup', {
                latlng: info.latlng,
                title: cardTitle(properties, config),
                html: propertyTable(properties, config.popup.properties),
                // Labels only: the card is data, and the press comes back as
                // the request's answer rather than through a handler.
                primaryAction: actions[0] && { label: actions[0].label },
                secondaryAction: actions[1] && { label: actions[1].label },
            })
            // Two-arg `then`, so a throw out of the emit is not reported as a
            // failure to show the card.
            .then(
                ({ action } = {}) => {
                    const pressed =
                        action === 'primary'
                            ? actions[0]
                            : action === 'secondary'
                              ? actions[1]
                              : null
                    // 'dismiss' and 'closed' are the card going away, which
                    // says nothing about the feature.
                    if (!pressed) return
                    this._api.emit(pressed.event, {
                        feature: info.feature,
                        layerId: info.layerId,
                        latlng: info.latlng,
                    })
                },
                (err) => console.warn('[FeaturePopup] showPopup failed', err)
            )
    },
}

/**
 * The actions a layer declares, capped at the two slots the card has. A
 * declaration needs both a label to show and an event to emit; anything else
 * would render a button that does nothing.
 */
function resolveActions(actions, layerId) {
    const usable = (Array.isArray(actions) ? actions : []).filter(
        (action) =>
            typeof action?.label === 'string' && typeof action?.event === 'string'
    )
    if (usable.length > 2) {
        console.warn(
            `[FeaturePopup] Layer "${layerId}" declares ${usable.length} popup ` +
                `actions; a card holds two, so the rest are ignored.`
        )
    }
    return usable.slice(0, 2)
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
    if (typeof template === 'string' && template.trim() !== '') {
        const filled = F_.bracketReplace(template, properties).trim()
        return filled === '' ? undefined : filled
    }
    const named = config.useKeyAsName
    const key = Array.isArray(named) ? named[0] : named
    return key == null ? undefined : properties[key]
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
        .filter((key) => properties[key] !== undefined)
        .map(
            (key) =>
                `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(
                    properties[key]
                )}</td></tr>`
        )
    return rows.length ? `<table>${rows.join('')}</table>` : undefined
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * The layers whose config carries a `featurePopup` block, keyed by layer id,
 * each alongside the property the layer already names its features by.
 */
function optedInLayers(configs) {
    const opted = new Map()
    Object.entries(configs || {}).forEach(([id, layer]) => {
        const popup = layer?.variables?.featurePopup
        // The block exists as soon as a mission touches the field, so the
        // switch is what opts the layer in; an untouched block still counts,
        // which is how a hand-written config reads.
        if (popup && popup.enabled !== false) {
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
