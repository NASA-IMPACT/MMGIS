/**
 * Chart plugin — MMGIS wrapper.
 *
 * Receiver-only. Subscribes (at module scope) to `plugin:fetch-stats:analysisReady`
 * and renders the per-layer stats payload via ChartComponent.
 *
 *   pluginId: 'chart'
 *
 *   Listens to:
 *     - plugin:fetch-stats:analysisReady   { analysisData: { [layerName]: <stats|null> } }
 *
 * This file is the only one in the plugin that touches mmgisAPI.
 * ChartComponent.tsx and chartHelpers.ts stay MMGIS-agnostic.
 */

import React from 'react'
import { render, unmountComponentAtNode } from 'react-dom'

import ChartComponent from './ChartComponent'

const PLUGIN_ID = 'chart'

// ── Module-level state ────────────────────────────────────────────────────────
// MMGIS tools are mutually exclusive, so when FetchStats emits `analysisReady`,
// Chart's `make()` hasn't run yet. The bus listener has to live at module
// scope to catch the emit; we stash the latest payload here and replay it
// to the instance once it mounts.
let _instance = null
let _latestAnalysisData = null

function _onAnalysisReady(payload) {
    _latestAnalysisData = payload?.analysisData ?? null
    if (_instance && _instance._root) {
        _instance._render()
        return
    }
    // Auto-open Chart panel by clicking its toolbar button.
    const btn =
        typeof document !== 'undefined' &&
        document.getElementById('toolButtonChart')
    if (btn) btn.click()
}

function _subscribeBus() {
    const api = typeof window !== 'undefined' ? window.mmgisAPI : null
    if (!api?.on) return false
    api.on('plugin:fetch-stats:analysisReady', _onAnalysisReady)
    return true
}

if (typeof window !== 'undefined') {
    if (!_subscribeBus()) {
        const id = setInterval(() => {
            if (_subscribeBus()) clearInterval(id)
        }, 50)
        setTimeout(() => clearInterval(id), 5000)
    }
}

// ── Tool ──────────────────────────────────────────────────────────────────────
const ChartTool = {
    // Collapse the docked side rail; the panel is `separatedTool: true`.
    height: 0,
    width: 0,
    MMGISInterface: null,
    _root: null,
    _api: null,

    make(targetId) {
        this.MMGISInterface = new interfaceWithMMGIS(this, targetId)

        this._api =
            (typeof window !== 'undefined' && window.mmgisAPI?.forPlugin?.(PLUGIN_ID)) ||
            { emit: () => {}, provide: () => () => {} }

        _instance = this
        this._render()
    },

    destroy() {
        if (this._root) {
            unmountComponentAtNode(this._root)
            this._root = null
        }
        if (this.MMGISInterface) {
            this.MMGISInterface.separateFromMMGIS()
            this.MMGISInterface = null
        }
        if (_instance === this) _instance = null
        this._api = null
    },

    getUrlString() {
        return ''
    },

    _render() {
        if (!this._root) return
        render(
            React.createElement(ChartComponent, {
                analysisData: _latestAnalysisData,
                onClose: () => this._onClose(),
            }),
            this._root
        )
    },

    _onClose() {
        const btn = document.getElementById('toolButtonChart')
        if (btn) btn.click()
    },
}

function interfaceWithMMGIS(tool) {
    const root = document.createElement('div')
    root.className = 'chart-tool-host'
    document.body.appendChild(root)
    tool._root = root

    this.separateFromMMGIS = function () {
        if (tool._root && tool._root.parentNode) {
            tool._root.parentNode.removeChild(tool._root)
        }
    }
}

export default ChartTool
