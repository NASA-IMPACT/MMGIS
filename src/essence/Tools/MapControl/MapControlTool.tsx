/**
 * MapControlTool — MMGIS tool wrapper for the MapControl bar.
 *
 * MapControl is a floating-panel tool: the modern layout's panel system creates
 * a container and calls make(targetId); we mount our React tree into it, exactly
 * like the AOI and Chart plugins. Placement (e.g. the top-right float zone) is
 * owned by the panel the tool is assigned to in the layout — the tool no longer
 * self-attaches a viewport overlay to document.body.
 *
 * All MMGIS coupling lives in MMGISMapControlAdapter + adapters/. The lib/ tree
 * is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISMapControlAdapter } from './MMGISMapControlAdapter'

const MapControlTool = {
    height: 0,
    width: 0,
    made: false,
    targetId: null as string | null,
    _reactRoot: null as Root | null,

    make(targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`MapControlTool: container ${this.targetId} not found`)
            return
        }
        this._reactRoot = createRoot(container)
        this._reactRoot.render(<MMGISMapControlAdapter />)
        this.made = true
    },

    destroy() {
        if (this._reactRoot) {
            this._reactRoot.unmount()
            this._reactRoot = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

export default MapControlTool
