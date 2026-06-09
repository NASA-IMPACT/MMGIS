/**
 * Chart plugin — MMGIS wrapper.
 *
 * Receiver-only. Subscribes (at module scope) to
 * `plugin:fetch-stats:analysisReady` and renders the per-layer stats payload
 * via ChartComponent.
 *
 *   pluginId: 'chart'
 *
 *   Listens to (module scope, survives Chart's own mount/unmount):
 *     - plugin:fetch-stats:analysisReady    { analysisData: { [layerName]: <stats|null> } }
 *     - plugin:aoi:analysisAOIReady         { feature } — clears stale data
 *                                                        when a new analysis starts
 *
 * This file is the only one in the plugin that touches mmgisAPI.
 * ChartComponent.tsx and chartHelpers.ts stay MMGIS-agnostic.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

import ChartComponent from './ChartComponent'

const TOOLBAR_BUTTON_ID = 'toolButtonChart'

// ── Module-level state ────────────────────────────────────────────────────────
// MMGIS tools are mutually exclusive, so when FetchStats emits `analysisReady`,
// Chart's `make()` hasn't run yet. The bus listeners have to live at module
// scope to catch the emit; we stash the latest payload here and replay it
// to the instance once it mounts.
let _instance = null
let _latestAnalysisData = null
let _subscribed = false

function _onAnalysisReady(payload) {
    _latestAnalysisData = payload?.analysisData ?? null
    if (_instance && _instance._root) {
        _instance._render()
        return
    }
    // Auto-open the Chart panel by clicking its toolbar button. MMGIS doesn't
    // currently expose a programmatic "activate tool" primitive, so we use the
    // convention every separated tool follows. If the button is missing —
    // toolbar still booting, markup change, or Chart not registered in the
    // mission — surface it loudly instead of silently dropping the open.
    if (typeof document === 'undefined') return
    const btn = document.getElementById(TOOLBAR_BUTTON_ID)
    if (btn) {
        btn.click()
    } else {
        console.warn(
            `[Chart] #${TOOLBAR_BUTTON_ID} not found; analysisReady payload ` +
                `is stashed but the panel could not auto-open. ` +
                `Is the Chart tool enabled in the mission config?`
        )
    }
}

function _onAnalysisStart() {
    // A new analysis is in flight — drop any prior payload so the user doesn't
    // briefly see stale results in the gap before FetchStats's analysisReady
    // arrives. Re-renders the panel if it's already open.
    _latestAnalysisData = null
    if (_instance && _instance._root) _instance._render()
}

function _subscribeBus() {
    if (_subscribed) return true
    const api = typeof window !== 'undefined' ? window.mmgisAPI : null
    if (!api?.on) return false
    api.on('plugin:fetch-stats:analysisReady', _onAnalysisReady)
    api.on('plugin:aoi:analysisAOIReady', _onAnalysisStart)
    _subscribed = true
    return true
}

if (typeof window !== 'undefined') {
    if (!_subscribeBus()) {
        const id = setInterval(() => {
            if (_subscribeBus()) clearInterval(id)
        }, 50)
        setTimeout(() => {
            clearInterval(id)
            if (!_subscribed) {
                console.warn(
                    '[Chart] mmgisAPI did not become available within 5s; ' +
                        'analysisReady events will not be received by the Chart panel.'
                )
            }
        }, 5000)
    }
}

// ── Tool ──────────────────────────────────────────────────────────────────────
const ChartTool = {
    // Collapse the docked side rail; the panel is `separatedTool: true`.
    height: 0,
    width: 0,
    MMGISInterface: null,
    _root: null,
    _reactRoot: null,

    make(targetId) {
        this.MMGISInterface = new interfaceWithMMGIS(this, targetId)
        _instance = this
        this._render()
    },

    destroy() {
        if (this._reactRoot) {
            this._reactRoot.unmount()
            this._reactRoot = null
        }
        this._root = null
        if (this.MMGISInterface) {
            this.MMGISInterface.separateFromMMGIS()
            this.MMGISInterface = null
        }
        if (_instance === this) _instance = null
    },

    getUrlString() {
        return ''
    },

    _render() {
        if (!this._reactRoot) return
        this._reactRoot.render(
            React.createElement(ChartComponent, {
                analysisData: _latestAnalysisData,
                onClose: () => this._onClose(),
            })
        )
    },

    _onClose() {
        // Same toolbar-button convention as _onAnalysisReady, same caveat.
        const btn = document.getElementById(TOOLBAR_BUTTON_ID)
        if (btn) {
            btn.click()
        } else {
            console.warn(
                `[Chart] #${TOOLBAR_BUTTON_ID} not found; cannot close ` +
                    `panel via the toolbar.`
            )
        }
    },
}

function interfaceWithMMGIS(tool) {
    const root = document.createElement('div')
    root.className = 'chart-tool-host'
    document.body.appendChild(root)
    tool._root = root
    tool._reactRoot = createRoot(root)

    this.separateFromMMGIS = function () {
        if (tool._root && tool._root.parentNode) {
            tool._root.parentNode.removeChild(tool._root)
        }
    }
}

export default ChartTool
