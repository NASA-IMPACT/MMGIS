import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISThemeRailAdapter } from './MMGISThemeRailAdapter'

let _root: Root | null = null

const LayerFilterThemesTool = {
    height: 0,
    width: 66,
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `LayerFilterThemesTool: container ${this.targetId} not found`,
            )
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISThemeRailAdapter />)
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

export default LayerFilterThemesTool
