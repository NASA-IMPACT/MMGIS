/**
 * LayerFilterThemes — the two-step filter's theme rail (step 1). Configures
 * its own theme list (id/label/icon) and owns which theme is selected; a
 * panel plugin (LayerFilter, or a swap-in) configures each theme's filters
 * under matching ids and follows the broadcast below.
 *
 * pluginId: 'layerfilterthemes'
 *
 * Emits:
 *   - plugin:layerfilterthemes:selectedThemeChanged  { themeId, initial? }
 *     `initial: true` marks the boot-time default so consumers can select it
 *     without treating it as user interaction.
 * Requests:
 *   - tool:getVars
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISThemeRailAdapter } from './MMGISThemeRailAdapter'

let _root: Root | null = null

const LayerFilterThemesTool = {
    height: 0,
    width: 66,
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `LayerFilterThemesTool: container ${this.targetId} not found`,
            )
            return
        }
        _root = createRoot(container)
        _root.render(<MMGISThemeRailAdapter />)
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

export default LayerFilterThemesTool
