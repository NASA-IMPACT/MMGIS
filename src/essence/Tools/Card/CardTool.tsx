import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISCardAdapter } from './MMGISCardAdapter'
import { mmgisRequest } from './adapters/mmgisAPI'

type ToolVars = { width?: number }

let _root: Root | null = null

const CardTool = {
    height: 0,
    width: 368 as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,
    made: false,

    initialize: async function () {
        try {
            const isMobile = await mmgisRequest<boolean>('app:isMobile')
            if (isMobile) {
                this.width = 'full'
                this.height = 500
            }
        } catch (err) {
            console.warn(
                '[CardTool] app:isMobile unavailable:',
                err instanceof Error ? err.message : err,
            )
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`CardTool: container ${this.targetId} not found`)
            return
        }
        // Don't force the classic dark panel background (var(--color-k) = #1d1f20).
        // In a themed modern panel that dark color shows through the card-list
        // padding/gaps as a dark frame around the light cards. Let the panel's
        // themed background show instead.
        _root = createRoot(container)
        _root.render(<MMGISCardAdapter />)
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

export default CardTool
