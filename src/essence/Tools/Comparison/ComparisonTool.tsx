/**
 * Comparison plugin — MMGIS tool wrapper (modern tool pattern).
 *
 * A completely independent unit: it talks to the rest of MMGIS only through the
 * mmgisAPI event bus. Two entry points hand off to it — the layers list's
 * "Compare layer" kebab entry and the timeline's "Compare date" action — each
 * by emitting an event naming the tab it needs; this tool listens, opens its
 * panel via the core plugin loader, and drives the core comparison capability
 * in either layout — swipe or side-by-side. Only lib/ is MMGIS-agnostic; this
 * wrapper, MMGISComparisonAdapter.tsx and adapters/ are the MMGIS-coupled
 * parts.
 *
 *   pluginId: 'comparison'
 *
 *   Listens to (module scope, survives the panel's own mount/unmount):
 *     - plugin:comparison:startWithLayer  { layerId } — seed + open the panel
 *       on the layers tab
 *     - plugin:comparison:startWithDates  — open the panel on the dates tab
 *
 *   Drives (via MMGISComparisonAdapter):
 *     - map:comparison:enable / :disable
 *     - layers:getAllConfigs / layers:getVisible  (dropdown options)
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
    MMGISComparisonAdapter,
    type ComparisonModeRequest,
} from './MMGISComparisonAdapter'
import type { ComparisonMode } from './lib/types'
import {
    mmgisOn,
    mmgisSetPluginState,
    mmgisShowPlugin,
} from '../_shared/adapters/mmgisAPI'

/** This plugin's canonical id, as declared in its config.json. */
const PLUGIN_ID = 'comparison'

// ── Module-level state ────────────────────────────────────────────────────────
// A hand-off can fire before make() has ever run, so the bus listeners live at
// module scope; they stash what the panel opens with, which make() then reads.
let _root: Root | null = null
let _seedLayerId: string | null = null
// The tab the last hand-off asked for. A fresh object per hand-off, so a repeat
// of the same tab still reaches a panel the user has since moved off it.
let _seedMode: ComparisonModeRequest | null = null
let _subscribed = false

function renderPanel(): void {
    if (!_root) return
    _root.render(
        React.createElement(MMGISComparisonAdapter, {
            seedLayerId: _seedLayerId,
            seedMode: _seedMode,
            onClose: handleClose,
        }),
    )
}

function handleClose(): void {
    _seedLayerId = null
    _seedMode = null
    // Fully unload (not just hide) so the next hand-off re-mounts a fresh panel
    // via startWithPanel's showPlugin request.
    mmgisSetPluginState(PLUGIN_ID, 'unloaded')
        .then((result) => {
            if (result.ok === false) {
                console.warn(`[Comparison] unload refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('[Comparison] unload failed:', err))
}

/** Opens the panel on `mode`, or moves it there if it is already open. */
function startWithPanel(mode: ComparisonMode): void {
    _seedMode = { mode }
    if (_root) renderPanel()
    mmgisShowPlugin(PLUGIN_ID)
        .then((result) => {
            if (result.ok === false) {
                console.warn(`[Comparison] showPlugin refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('[Comparison] showPlugin failed:', err))
}

function _onStartWithLayer(payload?: unknown): void {
    _seedLayerId = (payload as { layerId?: string })?.layerId ?? null
    startWithPanel('layers')
}

function _onStartWithDates(): void {
    startWithPanel('dates')
}

function subscribeBus(): boolean {
    if (_subscribed) return true
    if (typeof window === 'undefined' || !window.mmgisAPI?.on) return false
    mmgisOn('plugin:comparison:startWithLayer', _onStartWithLayer)
    mmgisOn('plugin:comparison:startWithDates', _onStartWithDates)
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
                    'the "Compare layer" and "Compare date" entries will not ' +
                    'open the panel.',
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
