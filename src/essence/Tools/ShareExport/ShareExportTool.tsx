import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISShareExportAdapter } from './MMGISShareExportAdapter'

// ShareExport renders a self-contained "Share map" trigger button that opens a
// small dropdown menu. Placement is layout-owned: the modern layout assigns the
// tool to a panel (e.g. a `float-top-right` floating panel declared in the
// mission's panelSettings) and calls make(targetId); we mount the React root
// into that assigned container, exactly like CardTool. Only the transient
// dropdown menu escapes the panel card (portaled to document.body by
// <ShareMenu>) so the float zone's overflow clipping can't cut it off.

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

        // Guard against a double-make: fully tear down the previous mount
        // (unmount the React root, then drop its host element).
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
