/**
 * Comparison plugin — MMGIS tool wrapper (modern tool pattern).
 *
 * A completely independent unit: it talks to the rest of MMGIS only through the
 * mmgisAPI event bus. The layers-list "Compare layer" kebab entry hands off by
 * emitting `plugin:comparison:startWithLayer`; this tool listens, opens its
 * panel via the core plugin loader, and drives the core swipe
 * capability. MMGISComparisonAdapter.tsx and the lib/ are MMGIS-agnostic; this
 * wrapper and adapters/ are the only MMGIS-coupled parts.
 *
 *   pluginId: 'comparison'
 *
 *   Listens to (module scope, survives the panel's own mount/unmount):
 *     - plugin:comparison:startWithLayer  { layerId } — seed + open the panel
 *
 *   Drives (via MMGISComparisonAdapter):
 *     - map:comparison:enable / :setLeftSide / :setRightSide / :disable
 *     - layers:getAllConfigs / layers:getVisible  (dropdown options)
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { MMGISComparisonAdapter } from './MMGISComparisonAdapter'
import { mmgisOn, mmgisEmit } from '../_shared/adapters/mmgisAPI'

const PLUGIN_ID = 'ComparisonTool'

// ── Module-level state ────────────────────────────────────────────────────────
// Comparison is `startUnloaded`, so when the kebab entry fires make() hasn't run
// yet. The bus listener lives at module scope to catch the emit; it stashes the
// seed layer and asks the core loader to open the panel, which then reads it.
let _root: Root | null = null
let _seedLayerId: string | null = null
let _subscribed = false

function renderPanel(): void {
    if (!_root) return
    _root.render(
        React.createElement(MMGISComparisonAdapter, {
            seedLayerId: _seedLayerId,
            onClose: handleClose,
        }),
    )
}

function handleClose(): void {
    _seedLayerId = null
    // Fully unload (not just hide) so the next "Compare layer" re-mounts a fresh
    // panel via _onStartWithLayer's core:loadPlugin emit.
    mmgisEmit('core:unloadPlugin', { pluginId: PLUGIN_ID })
}

function _onStartWithLayer(payload?: unknown): void {
    _seedLayerId = (payload as { layerId?: string })?.layerId ?? null
    if (_root) {
        // Panel already open — re-seed the left side in place.
        renderPanel()
        return
    }
    mmgisEmit('core:loadPlugin', { pluginId: PLUGIN_ID })
}

function subscribeBus(): boolean {
    if (_subscribed) return true
    if (typeof window === 'undefined' || !window.mmgisAPI?.on) return false
    mmgisOn('plugin:comparison:startWithLayer', _onStartWithLayer)
    _subscribed = true
    return true
}

if (typeof window !== 'undefined' && !subscribeBus()) {
    const id = setInterval(() => {
        if (subscribeBus()) clearInterval(id)
    }, 50)
    setTimeout(() => {
        clearInterval(id)
        if (!_subscribed) {
            console.warn(
                '[Comparison] mmgisAPI did not become available within 5s; ' +
                    'the "Compare layer" entry will not open the panel.',
            )
        }
    }, 5000)
}

// ── Tool (modern pattern) ─────────────────────────────────────────────────────
const ComparisonTool = {
    // Fills whatever container the modern layout mounts it into; the layout
    // owns the panel's position and size.
    height: 0,
    width: 350 as number | 'full',
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`ComparisonTool: container ${this.targetId} not found`)
            return
        }
        _root = createRoot(container)
        this.made = true
        renderPanel()
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

export default ComparisonTool
