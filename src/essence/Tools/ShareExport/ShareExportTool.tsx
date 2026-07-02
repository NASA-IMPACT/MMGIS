import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISShareExportAdapter } from './MMGISShareExportAdapter'

// ShareExport's "Share map" control. Placement is layout-owned: the layout
// assigns the tool a panel (e.g. a `float-top-right` floating panel) and calls
// make(targetId); the React root mounts into that container. Only the
// transient dropdown escapes the panel card (portaled by <ShareMenu>).

const HOST_ID = 'shareExport-tool-host'

let _root: Root | null = null
let _host: HTMLDivElement | null = null

const ShareExportTool = {
    height: 0,
    width: 0 as number | 'full',
    targetId: null as string | null,
    made: false,

    initialize: async function () {
        // No async setup required; the menu reads its config on mount.
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `ShareExportTool: container ${this.targetId} not found`,
            )
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
        // (.shareExport-tool-host) without leaking into the panel.
        _host = document.createElement('div')
        _host.id = HOST_ID
        _host.className = 'shareExport-tool-host'
        container.appendChild(_host)

        _root = createRoot(_host)
        _root.render(<MMGISShareExportAdapter />)
        this.made = true
    },

    destroy: function () {
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

    getUrlString: function () {
        return ''
    },
}

export default ShareExportTool
