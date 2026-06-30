import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISShareExportAdapter } from './MMGISShareExportAdapter'

// ShareExport renders a self-contained "Share map" control floating in the
// top-right action area (alongside the AOI "Analyze areas" cluster), NOT in the
// left layers panel. The modern/default layout assigns the tool to a panel and
// calls make(targetId), but — exactly like the AOI plugin — we ignore that
// docked target and mount our own position:fixed host on document.body so the
// trigger + dropdown float over the map. width:0/height:0 in config.json keeps
// the assigned panel slot collapsed.

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
        this.targetId = typeof targetId === 'string' ? targetId : null

        // Reuse a single floating host; guard against a double-make.
        if (_host && _host.parentNode) {
            _host.parentNode.removeChild(_host)
        }
        _host = document.createElement('div')
        _host.id = HOST_ID
        _host.className = 'shareExport-tool-host'
        document.body.appendChild(_host)

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
