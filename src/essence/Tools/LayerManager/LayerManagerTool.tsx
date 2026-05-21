import React from 'react'
import $ from 'jquery'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISLayerManagerAdapter } from './MMGISLayerManagerAdapter'
import { mmgisRequest, mmgisProvide, mmgisEmit } from './adapters/mmgisAPI'

type ToolVars = { width?: number }

let _root: Root | null = null

const LayerManagerTool = {
    height: 0,
    width: 320 as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,
    made: false,
    _cleanups: [] as Array<() => void>,

    initialize: async function () {
        // Both handlers are registered by Layers_.fina() during mission load.
        // If initialize() fires before that (e.g. in a modern-layout boot path
        // where the tool registers before Layers_ runs fina), the requests
        // reject. Catch each independently so the tool still mounts with
        // defaults instead of throwing an uncaught rejection at startup.
        try {
            this.vars =
                (await mmgisRequest<ToolVars>(
                    'tool:getVars',
                    'layermanager',
                )) || {}
            if (this.vars.width) this.width = this.vars.width
        } catch (err) {
            console.warn(
                '[LayerManagerTool] tool:getVars unavailable:',
                err instanceof Error ? err.message : err,
            )
        }
        try {
            const isMobile = await mmgisRequest<boolean>('app:isMobile')
            if (isMobile) {
                this.width = 'full'
                this.height = 500
            }
        } catch (err) {
            console.warn(
                '[LayerManagerTool] app:isMobile unavailable:',
                err instanceof Error ? err.message : err,
            )
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `LayerManagerTool: container ${this.targetId} not found`,
            )
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISLayerManagerAdapter />)
        this.made = true

        this._cleanups.push(
            mmgisProvide('plugin:layermanager:refresh', () => {
                // Refresh is owned by the React adapter via its own event subscriptions;
                // re-emit the canonical event so the adapter picks it up.
                mmgisEmit('layer:refreshStatusChange')
                return true
            }),
        )

        mmgisEmit('plugin:layermanager:ready', { timestamp: Date.now() })
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

export default LayerManagerTool
