import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISLayerFilterAdapter } from './MMGISLayerFilterAdapter'
import { mmgisRequest, mmgisProvide, mmgisEmit } from '../_shared/adapters/mmgisAPI'
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

    initialize: async function () {
        try {
            this.vars =
                (await mmgisRequest<ToolVars>('tool:getVars', 'layerfilter')) || {}
            if (this.vars.width) this.width = this.vars.width
        } catch (err) {
            console.warn(
                '[LayerFilterTool] tool:getVars unavailable:',
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
            mmgisProvide('layerFilter:getThemes', () => ({
                themes: (this.vars.themes || []).map((t) => ({
                    id: t.id,
                    label: t.label,
                    icon: t.icon,
                })),
                defaultThemeId: this.vars.defaultThemeId,
            })),
        )
        mmgisEmit('layerFilter:ready', { timestamp: Date.now() })
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
