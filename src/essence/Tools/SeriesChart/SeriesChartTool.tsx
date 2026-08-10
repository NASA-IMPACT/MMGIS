import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISSeriesChartAdapter } from './MMGISSeriesChartAdapter'

let _root: Root | null = null

const SeriesChartTool = {
    height: 0,
    width: 400 as number | 'full',
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`SeriesChartTool: container ${this.targetId} not found`)
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISSeriesChartAdapter />)
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

export default SeriesChartTool
