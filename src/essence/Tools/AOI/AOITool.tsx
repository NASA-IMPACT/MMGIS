/**
 * AOITool — MMGIS tool wrapper for the AOI plugin.
 *
 * AOI is a separated (floating) tool: it self-mounts into an `.aoi-tool-host`
 * div on document.body rather than a docked panel target. All state + bus
 * wiring lives in MMGISAOIAdapter; the lib/ tree is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISAOIAdapter } from './MMGISAOIAdapter'

let _root: Root | null = null
let _host: HTMLDivElement | null = null

const AOITool = {
    height: 0,
    width: 0,
    made: false,

    make() {
        if (_root) return
        _host = document.createElement('div')
        _host.className = 'aoi-tool-host'
        document.body.appendChild(_host)
        _root = createRoot(_host)
        _root.render(<MMGISAOIAdapter />)
        this.made = true
    },

    destroy() {
        if (_root) {
            _root.unmount()
            _root = null
        }
        if (_host && _host.parentNode) _host.parentNode.removeChild(_host)
        _host = null
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

export default AOITool
