/**
 * AddTempLayerTool — MMGIS tool wrapper for the AddTempLayer plugin.
 *
 * Mounts the React tree into the panel target MMGIS assigns via make(targetId).
 * All bus wiring lives in MMGISAddTempLayerAdapter; the lib/ tree is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISAddTempLayerAdapter } from './MMGISAddTempLayerAdapter'

let _root: Root | null = null

const AddTempLayerTool = {
    height: 0,
    width: 300 as number | 'full',
    targetId: null as string | null,
    made: false,

    make(targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`AddTempLayerTool: container ${this.targetId} not found`)
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISAddTempLayerAdapter />)
        this.made = true
    },

    destroy() {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

export default AddTempLayerTool
