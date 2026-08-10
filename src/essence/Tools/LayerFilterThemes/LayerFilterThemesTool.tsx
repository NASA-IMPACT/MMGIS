/**
 * LayerFilterThemes — the two-step filter's theme rail (step 1). Not
 * functional without a panel plugin providing the themes (LayerFilter, or a
 * swap-in honoring the same contract).
 *
 * pluginId: 'layerfilterthemes'
 *
 * Emits:
 *   - plugin:layerfilterthemes:selectedThemeChanged  { themeId }  (user clicks only)
 * Requests:
 *   - plugin:layerfilter:getThemes → { themes: [{ id, label, icon }], defaultThemeId }
 * Subscribes:
 *   - plugin:layerfilter:ready — re-pulls the theme list after the panel's
 *     config resolves
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
