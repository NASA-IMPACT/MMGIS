/**
 * MapControlTool — MMGIS mount/unmount shim (modern tool pattern).
 *
 * MapControl renders the floating MapControlBar overlay (basemap switcher,
 * search, measure, zoom). Like every modern tool it does nothing at import
 * time: the tool controller calls make(targetId) only when the tool is
 * enabled, and destroy() when it's turned off. This is what keeps it from
 * showing when the tool is off.
 *
 * All MMGIS coupling lives in MMGISMapControlAdapter + adapters/. The lib/ tree
 * is portable.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISMapControlAdapter } from './MMGISMapControlAdapter'

let _root: Root | null = null
// Remembers the container's inline position so destroy() can put it back,
// since we only override it when the container is statically positioned.
let _restorePosition: { el: HTMLElement; value: string } | null = null

const MapControlTool = {
    height: 0,
    width: 0,
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `MapControlTool: container ${this.targetId} not found`
            )
            return
        }
        // The bar is absolutely positioned; make the mount container the
        // positioning context so it anchors to this parent rather than
        // escaping to the nearest positioned ancestor / the viewport.
        if (getComputedStyle(container).position === 'static') {
            _restorePosition = { el: container, value: container.style.position }
            container.style.position = 'relative'
        }
        _root = createRoot(container)
        _root.render(<MMGISMapControlAdapter />)
        this.made = true
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        if (_restorePosition) {
            _restorePosition.el.style.position = _restorePosition.value
            _restorePosition = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

export default MapControlTool
