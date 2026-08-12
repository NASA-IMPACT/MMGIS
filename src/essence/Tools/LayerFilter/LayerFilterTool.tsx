/**
 * LayerFilter — the two-step filter's panel (step 2: the active theme's
 * filters). The theme rail (LayerFilterThemes) is a separate, swappable tool
 * that configures its own entries and owns the selection; this tool
 * configures each theme's filters under matching ids.
 *
 * pluginId: 'layerfilter'
 *
 * Emits:
 *   - plugin:layerfilter:changed  { themeId, selections, matchedLayerUUIDs }
 * Subscribes:
 *   - plugin:layerfilterthemes:selectedThemeChanged  { themeId, initial? }
 * Requests:
 *   - tool:getVars, layers:getAllConfigs, layers:setListed
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISLayerFilterAdapter } from './MMGISLayerFilterAdapter'
import { mmgisRequest, mmgisHasHandler } from '../_shared/adapters/mmgisAPI'

type ToolVars = {
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

    // Only `width` is read here — the panel's themes/catalogue are read by
    // the React adapter itself, which polls for 'tool:getVars' the same way.
    initialize: async function () {
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

export default LayerFilterTool
