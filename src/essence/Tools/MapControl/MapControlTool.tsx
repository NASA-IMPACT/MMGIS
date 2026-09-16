/**
 * MapControlTool — MMGIS tool wrapper for the MapControl bar.
 *
 * Placement is layout-owned: the layout assigns the tool a panel (typically a
 * `float-top-right` floating panel over the map) and calls make(targetId); the
 * React root mounts into that container. The measure distance label escapes
 * the panel card (portaled onto the map container by <MapControlBar>).
 *
 * All MMGIS coupling lives in MMGISMapControlAdapter + adapters/. The lib/
 * tree is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISMapControlAdapter } from './MMGISMapControlAdapter'

const HOST_ID = 'mapControl-tool-host'

let _root: Root | null = null
let _host: HTMLDivElement | null = null

const MapControlTool = {
    height: 0,
    width: 0,
    targetId: null as string | null,
    made: false,

    make(targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`MapControlTool: container ${this.targetId} not found`)
            return
        }

        // Double-make guard: fully tear down the previous mount.
        if (_root) {
            _root.unmount()
            _root = null
        }
        if (_host && _host.parentNode) {
            _host.parentNode.removeChild(_host)
        }

        // A dedicated host element scopes the plugin's styles/tokens
        // without leaking into the panel.
        _host = document.createElement('div')
        _host.id = HOST_ID
        _host.className = 'mapControl-tool-host'
        container.appendChild(_host)

        _root = createRoot(_host)
        _root.render(<MMGISMapControlAdapter />)
        this.made = true
    },

    destroy() {
        if (_root) {
            _root.unmount()
            _root = null
        }
        if (_host && _host.parentNode) {
            _host.parentNode.removeChild(_host)
        }
        _host = null
        this.targetId = null
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

export default MapControlTool
