/**
 * ScaleBarTool — MMGIS tool wrapper for the map scale bar.
 *
 * Placement is layout-owned: the layout assigns the tool a panel (typically a
 * `float-bottom-left` floating panel over the map) and calls make(targetId);
 * the React root mounts into that container.
 *
 * All MMGIS coupling lives in MMGISScaleBarAdapter. The lib/ tree is
 * portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISScaleBarAdapter } from './MMGISScaleBarAdapter'

const HOST_ID = 'scaleBar-tool-host'

let _root: Root | null = null
let _host: HTMLDivElement | null = null

const ScaleBarTool = {
    height: 0,
    width: 0,
    targetId: null as string | null,
    made: false,

    make(targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`ScaleBarTool: container ${this.targetId} not found`)
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

        _host = document.createElement('div')
        _host.id = HOST_ID
        _host.className = 'scaleBar-tool-host'
        container.appendChild(_host)

        _root = createRoot(_host)
        _root.render(<MMGISScaleBarAdapter />)
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

export default ScaleBarTool
