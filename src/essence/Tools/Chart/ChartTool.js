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
import { mmgisShowPlugin, mmgisSetPluginState } from '../_shared/adapters/mmgisAPI'

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
    if (_instance && _instance._reactRoot) {
        _instance._render()
        return
    }
    // Auto-open the Chart panel. Chart is registered `startUnloaded: true`,
    // so make() hasn't run yet — showPlugin loads it into its existing
    // container and reveals it in one call.
    mmgisShowPlugin('ChartTool')
        .then((result) => {
            if (!result.ok) {
                console.warn(`[Chart] showPlugin refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('[Chart] showPlugin failed:', err))
}

function _onAnalysisStart() {
    // A new analysis is in flight — drop any prior payload so the user doesn't
    // briefly see stale results in the gap before FetchStats's analysisReady
    // arrives. Re-renders the panel if it's already open.
    _latestAnalysisData = null
    if (_instance && _instance._reactRoot) _instance._render()
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
    targetId: null,
    _reactRoot: null,

    make(targetId) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`ChartTool: container ${this.targetId} not found`)
            return
        }
        this._reactRoot = createRoot(container)
        _instance = this
        this._render()
    },

    destroy() {
        if (this._reactRoot) {
            this._reactRoot.unmount()
            this._reactRoot = null
        }
        this.targetId = null
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
        // Fully unload (not just hide) so a later analysisReady re-mounts a
        // fresh instance via _onAnalysisReady's showPlugin call.
        mmgisSetPluginState('ChartTool', 'unloaded')
            .then((result) => {
                if (!result.ok) {
                    console.warn(`[Chart] unload refused: ${result.reason}`)
                }
            })
            .catch((err) => console.warn('[Chart] unload failed:', err))
    },
}

export default ChartTool
