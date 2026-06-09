/**
 * MapControlTool — MMGIS tool wrapper for the MapControl floating overlay.
 *
 * Unlike a docked panel tool, MapControl is a floating overlay: it self-mounts
 * into a viewport-fixed, click-through layer on document.body. src/pre/tools.js
 * eagerly imports every tool at app start, so the module-level auto-mount polls
 * until the map is alive, then mounts. The _root guard prevents double-mounting
 * if the panel system also calls make().
 *
 * All MMGIS coupling lives in MMGISMapControlAdapter + adapters/. The lib/ tree
 * is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISMapControlAdapter } from './MMGISMapControlAdapter'

const ROOT_ID = 'mmgis-map-control-root'
const ROOT_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:1002;'
const APP_READY_IDS = ['mapScreen', 'modern-content', 'map']

function isAppReady(): boolean {
    return APP_READY_IDS.some((id) => document.getElementById(id) !== null)
}

let _root: Root | null = null

const MapControlTool = {
    height: 0,
    width: 0,
    made: false,

    make() {
        if (_root) return
        document.getElementById(ROOT_ID)?.remove()
        const container = document.createElement('div')
        container.id = ROOT_ID
        container.style.cssText = ROOT_STYLE
        document.body.appendChild(container)
        _root = createRoot(container)
        _root.render(<MMGISMapControlAdapter />)
        this.made = true
    },

    destroy() {
        if (_root) {
            _root.unmount()
            _root = null
        }
        document.getElementById(ROOT_ID)?.remove()
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

function tryAutoMount(): boolean {
    if (_root) return true
    if (!isAppReady()) return false
    MapControlTool.make()
    return true
}

if (typeof window !== 'undefined') {
    if (!tryAutoMount()) {
        const id = setInterval(() => {
            if (tryAutoMount()) clearInterval(id)
        }, 100)
        setTimeout(() => clearInterval(id), 15000)
    }
}

export default MapControlTool
