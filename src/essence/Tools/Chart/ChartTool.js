/**
 * Chart plugin — MMGIS wrapper.
 *
 * Pluggable contract (see PLUGIN-DEVELOPMENT-GUIDE.md):
 *
 *   pluginId: 'chart'
 *
 *   Listens to:
 *     - plugin:aoi:analysisRequested  { feature, layerName? }
 *     - plugin:aoi:analysisCancelled
 *
 *   Requests (existing core handlers):
 *     - layers:getAll      -> string[]            (all layer UUIDs)
 *     - layers:getVisible  -> { uuid: boolean }   (visibility map)
 *     - layers:getConfig   -> full layer config (incl. variables.analysis)
 *     - time:getStart      -> ISO string
 *     - time:getEnd        -> ISO string
 *
 *   This file is the only one in the plugin that touches mmgisAPI.
 *   ChartComponent.tsx and chartHelpers.ts stay MMGIS-agnostic.
 */

import React from 'react'
import { render, unmountComponentAtNode } from 'react-dom'

import ChartComponent from './ChartComponent'
import {
    bboxOf,
    buildChartSpecs,
    buildItemsUrl,
    buildStatsUrl,
    proxyifyForDev,
    readAnalysisConfig,
} from './chartHelpers'

const PLUGIN_ID = 'chart'

/**
 * Module-level bridge.
 *
 * `pre/tools.js` imports this file eagerly at app startup, so the
 * subscription below runs before the user clicks any toolbar button.
 * That lets AOI's emit reach Chart even when Chart's panel isn't open
 * yet — the bridge auto-opens Chart by clicking its toolbar button and
 * stashes the payload until `make()` runs and picks it up.
 */
let _chartToolInstance = null
let _pendingPayload = null

function _bridgeAnalysisRequested(payload) {
    if (_chartToolInstance && _chartToolInstance._root) {
        _chartToolInstance._handleAnalysisRequest(payload)
        return
    }
    _pendingPayload = payload
    const btn =
        typeof document !== 'undefined' &&
        document.getElementById('toolButtonChart')
    if (btn) btn.click()
}

function _bridgeAnalysisCancelled() {
    _pendingPayload = null
    if (_chartToolInstance && _chartToolInstance._root) {
        _chartToolInstance._reset()
    }
}

function _subscribeBus() {
    const api = typeof window !== 'undefined' ? window.mmgisAPI : null
    if (!api?.on) return false
    api.on('plugin:aoi:analysisRequested', _bridgeAnalysisRequested)
    api.on('plugin:aoi:analysisCancelled', _bridgeAnalysisCancelled)
    return true
}

if (typeof window !== 'undefined') {
    if (!_subscribeBus()) {
        // mmgisAPI not yet bound — retry briefly, then stop.
        const id = setInterval(() => {
            if (_subscribeBus()) clearInterval(id)
        }, 50)
        setTimeout(() => clearInterval(id), 5000)
    }
}

const initialState = () => ({
    status: 'idle',
    summary: '',
    charts: [],
    layers: [],
    selectedLayer: null,
    errorMessage: '',
    emptyMessage: '',
})

const ChartTool = {
    height: 400,
    width: 360,
    MMGISInterface: null,
    _root: null,
    _state: initialState(),
    _cleanups: [],
    _api: null,
    _lastFeature: null,

    make(targetId) {
        // ToolController_ passes 'toolContentSeparated_Chart' for separated tools.
        // We mount our root into that container if it exists; otherwise fall back
        // to body (used as a development safety net).
        this.MMGISInterface = new interfaceWithMMGIS(this, targetId)

        this._api =
            (typeof window !== 'undefined' && window.mmgisAPI?.forPlugin?.(PLUGIN_ID)) ||
            { emit: () => {}, provide: () => () => {} }

        // Bus subscriptions live at module level (see top of file) so AOI's
        // emit can auto-open this panel even when it isn't currently mounted.
        // Register this instance with the bridge.
        _chartToolInstance = this

        this._render()

        // If a payload arrived before we mounted, process it now.
        if (_pendingPayload) {
            const payload = _pendingPayload
            _pendingPayload = null
            this._handleAnalysisRequest(payload)
        }
    },

    destroy() {
        this._cleanups.forEach((fn) => {
            try {
                fn()
            } catch {
                // intentionally swallow — destroy must remain idempotent
            }
        })
        this._cleanups = []

        if (this._root) {
            unmountComponentAtNode(this._root)
        }

        if (this.MMGISInterface) {
            this.MMGISInterface.separateFromMMGIS()
            this.MMGISInterface = null
        }

        this._root = null

        this._state = initialState()
        this._lastFeature = null
        this._api = null
    },

    getUrlString() {
        return ''
    },

    _setState(patch) {
        this._state = { ...this._state, ...patch }
        this._render()
    },

    _render() {
        if (!this._root) return
        render(
            React.createElement(ChartComponent, {
                status: this._state.status,
                summary: this._state.summary,
                charts: this._state.charts,
                layers: this._state.layers,
                selectedLayer: this._state.selectedLayer,
                errorMessage: this._state.errorMessage,
                emptyMessage: this._state.emptyMessage,
                onSelectLayer: (name) => this._onSelectLayer(name),
                onExit: () => this._onExit(),
                onClose: () => this._onClose(),
            }),
            this._root
        )
    },

    async _handleAnalysisRequest(payload) {
        const feature = payload?.feature
        if (!feature) return
        this._lastFeature = feature

        const layers = await this._getAnalyzableLayers()
        if (!layers.length) {
            this._setState({
                status: 'empty',
                emptyMessage:
                    'No active layer with timeseries analysis support.',
                charts: [],
                layers: [],
                selectedLayer: null,
            })
            return
        }

        // Preserve selection if still valid; otherwise default to first.
        let selectedLayer = this._state.selectedLayer
        if (!selectedLayer || !layers.find((l) => l.name === selectedLayer)) {
            selectedLayer = layers[0].name
        }

        this._setState({
            status: 'loading',
            layers,
            selectedLayer,
            charts: [],
            errorMessage: '',
        })

        await this._fetchSelectedLayer()
    },

    async _onSelectLayer(name) {
        if (name === this._state.selectedLayer) return
        this._setState({ selectedLayer: name, status: 'loading' })
        if (this._lastFeature) await this._fetchSelectedLayer()
    },

    async _fetchSelectedLayer() {
        const layer = this._state.layers.find(
            (l) => l.name === this._state.selectedLayer
        )
        if (!layer || !this._lastFeature) return

        const bbox = bboxOf(this._lastFeature.geometry)
        if (!bbox) {
            this._setState({
                status: 'error',
                errorMessage: 'AOI geometry has no usable bounding box.',
            })
            return
        }

        try {
            // Step 1 — list STAC items in the collection that intersect the bbox.
            const itemsUrl = proxyifyForDev(
                buildItemsUrl({
                    baseUrl: layer.baseUrl,
                    collection: layer.collection,
                    bbox,
                })
            )
            const itemsResp = await fetch(itemsUrl, { credentials: 'include' })
            if (!itemsResp.ok) {
                throw new Error(`STAC items request failed (${itemsResp.status})`)
            }
            const itemsJson = await itemsResp.json()
            const items = Array.isArray(itemsJson?.features)
                ? itemsJson.features
                : []

            if (!items.length) {
                this._setState({
                    status: 'empty',
                    emptyMessage: 'No data found for this area.',
                    charts: [],
                    summary: layer.summary || '',
                    errorMessage: '',
                })
                return
            }

            // Step 2 — POST per-item statistics with the AOI geometry.
            const body = JSON.stringify({
                type: 'Feature',
                geometry: this._lastFeature.geometry,
                properties: {},
            })
            const headers = { 'Content-Type': 'application/json' }
            const pairs = await Promise.all(
                items.map(async (item) => {
                    // titiler-pgstac requires `assets=` on POST /statistics.
                    // Prefer the layer's config; fall back to the asset keys
                    // declared on the STAC item itself.
                    const assetsForRequest =
                        layer.assets && layer.assets.length
                            ? layer.assets
                            : Object.keys(item.assets || {})
                    if (!assetsForRequest.length) return { item, stats: null }
                    try {
                        const statsUrl = proxyifyForDev(
                            buildStatsUrl({
                                baseUrl: layer.baseUrl,
                                collection: layer.collection,
                                itemId: item.id,
                                assets: assetsForRequest,
                            })
                        )
                        const resp = await fetch(statsUrl, {
                            method: 'POST',
                            headers,
                            body,
                            credentials: 'include',
                        })
                        if (!resp.ok) return { item, stats: null }
                        return { item, stats: await resp.json() }
                    } catch {
                        return { item, stats: null }
                    }
                })
            )

            // If every POST failed, surface as an error — don't collapse to
            // the same "empty" copy the config-missing case uses.
            const failedCount = pairs.filter((p) => p.stats === null).length
            if (failedCount === pairs.length) {
                this._setState({
                    status: 'error',
                    errorMessage: `Failed to fetch statistics for this area (${failedCount} of ${pairs.length} requests failed).`,
                })
                return
            }

            const charts = buildChartSpecs(pairs, layer.assets, layer.statistic)
            this._setState({
                status: charts.length ? 'ready' : 'empty',
                emptyMessage: charts.length
                    ? ''
                    : 'No valid statistics found for this area.',
                charts,
                summary: layer.summary || '',
                errorMessage: '',
            })
        } catch (err) {
            this._setState({
                status: 'error',
                errorMessage: err?.message || 'Failed to fetch timeseries data.',
            })
        }
    },

    async _getAnalyzableLayers() {
        const api = window.mmgisAPI
        if (!api?.request) return []
        try {
            const [allNames, visible] = await Promise.all([
                api.request('layers:getAll'),
                api.request('layers:getVisible'),
            ])
            const names = Array.isArray(allNames) ? allNames : []
            const out = []
            for (const name of names) {
                if (!visible?.[name]) continue
                const cfg = await api.request('layers:getConfig', name)
                const analysis = readAnalysisConfig(cfg, name)
                if (analysis) out.push(analysis)
            }
            return out
        } catch (err) {
            console.warn('[Chart] layer enumeration failed', err)
            return []
        }
    },

    _onExit() {
        this._reset()
        this._api?.emit('analysisExited', {})
    },

    _reset() {
        this._lastFeature = null
        this._setState({
            status: 'idle',
            summary: '',
            charts: [],
            layers: [],
            selectedLayer: null,
            errorMessage: '',
            emptyMessage: '',
        })
    },

    _onClose() {
        const btn = document.getElementById('toolButtonChart')
        if (btn) btn.click()
    },
}

function interfaceWithMMGIS(tool, targetId) {
    // Prefer the container ToolController_ created for this separated tool
    // (toolContentSeparated_Chart); fall back to body if missing.
    const container =
        (typeof targetId === 'string' && document.getElementById(targetId)) ||
        document.body

    const root = document.createElement('div')
    root.className = 'chart-tool-host'
    root.style.position = 'fixed'
    root.style.top = '60px'
    root.style.right = '16px'
    root.style.width = '360px'
    root.style.height = '600px'
    root.style.maxHeight = 'calc(100vh - 80px)'
    root.style.zIndex = '1005'
    root.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.12)'
    root.style.borderRadius = '4px'
    root.style.overflow = 'hidden'
    container.appendChild(root)
    tool._root = root

    this.separateFromMMGIS = function () {
        if (tool._root && tool._root.parentNode) {
            tool._root.parentNode.removeChild(tool._root)
        }
    }
}

export default ChartTool
