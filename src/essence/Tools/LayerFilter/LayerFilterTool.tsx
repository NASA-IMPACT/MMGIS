/**
 * LayerFilter — the two-step filter's panel (step 2: the active theme's
 * filters). The theme rail (LayerFilterThemes) is a separate, swappable tool.
 *
 * pluginId: 'layerfilter'
 *
 * Provides:
 *   - plugin:layerfilter:getThemes → { themes: [{ id, label, icon }], defaultThemeId }
 * Emits:
 *   - plugin:layerfilter:ready    { timestamp } — after vars resolve; the rail re-pulls themes
 *   - plugin:layerfilter:changed  { themeId, selections, matchedLayerUUIDs }
 * Subscribes:
 *   - plugin:layerfilterthemes:selectedThemeChanged  { themeId }
 * Requests:
 *   - tool:getVars, layers:getAllConfigs, layers:setListed
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISLayerFilterAdapter } from './MMGISLayerFilterAdapter'
import {
    mmgisRequest,
    mmgisProvide,
    mmgisEmit,
    mmgisHasHandler,
} from '../_shared/adapters/mmgisAPI'
import type { ThemeDef } from './lib/types'

type ToolVars = {
    themes?: ThemeDef[]
    defaultThemeId?: string
    themeProperty?: string
    width?: number
}

let _root: Root | null = null

const LayerFilterTool = {
    height: 0,
    width: 320 as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,
    made: false,
    _cleanups: [] as Array<() => void>,

    // Tracked so make() can defer its ready announcement until the vars the
    // announcement advertises actually exist (the controller calls
    // initialize() without awaiting, then make() synchronously).
    _varsLoaded: null as Promise<void> | null,

    initialize: function () {
        this._varsLoaded = this._loadVars()
        return this._varsLoaded
    },

    _loadVars: async function () {
        try {
            // 'tool:getVars' registers in Layers_.fina() after all mission
            // layers load — always later than tool init. Poll for it instead
            // of losing the race with a single early request.
            const start = Date.now()
            while (!mmgisHasHandler('tool:getVars')) {
                if (Date.now() - start > 20000) {
                    console.warn(
                        '[LayerFilterTool] tool:getVars never registered — using defaults',
                    )
                    return
                }
                await new Promise((r) => setTimeout(r, 200))
            }
            this.vars =
                (await mmgisRequest<ToolVars>('tool:getVars', 'layerfilter')) || {}
            // Hand-authored config: only accept a sane numeric width.
            if (
                typeof this.vars.width === 'number' &&
                Number.isFinite(this.vars.width) &&
                this.vars.width > 0
            ) {
                this.width = this.vars.width
            }
        } catch (err) {
            console.warn(
                '[LayerFilterTool] tool:getVars failed:',
                err instanceof Error ? err.message : err,
            )
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`LayerFilterTool: container ${this.targetId} not found`)
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISLayerFilterAdapter />)
        this.made = true

        // Expose the theme list (id/label/icon) + default for the rail tool,
        // and announce readiness so the rail can (re-)request after we mount.
        this._cleanups.push(
            mmgisProvide('plugin:layerfilter:getThemes', () => ({
                themes: (this.vars.themes || []).map((t) => ({
                    id: t.id,
                    label: t.label,
                    icon: t.icon,
                })),
                defaultThemeId: this.vars.defaultThemeId,
            })),
        )
        // Announce readiness only once the vars the rail will ask for have
        // resolved — a synchronous emit here races the rail into latching
        // onto an empty theme list with no second announcement coming.
        void (this._varsLoaded ?? Promise.resolve()).then(() => {
            if (this.made) {
                mmgisEmit('plugin:layerfilter:ready', { timestamp: Date.now() })
            }
        })
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this._cleanups.forEach((cleanup) => cleanup())
        this._cleanups = []
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

export default LayerFilterTool
