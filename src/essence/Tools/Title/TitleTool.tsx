// Title Tool — MMGIS mount/unmount shim (modern tool pattern).
// All config reading and behaviour lives in MMGISTitleAdapter; the portable
// presentational component is lib/Title.
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISTitleAdapter } from './MMGISTitleAdapter'

let _root: Root | null = null

const TitleTool = {
    height: 60,
    width: 'full' as number | 'full',
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`TitleTool: container ${this.targetId} not found`)
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISTitleAdapter />)
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

export default TitleTool
