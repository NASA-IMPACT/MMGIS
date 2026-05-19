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
        this.vars =
            (await mmgisRequest<ToolVars>('tool:getVars', 'layermanager')) || {}
        if (this.vars.width) this.width = this.vars.width
        const isMobile = await mmgisRequest<boolean>('app:isMobile')
        if (isMobile) {
            this.width = 'full'
            this.height = 500
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
        $(container).css('background', 'var(--color-k)')
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
