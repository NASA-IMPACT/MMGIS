/**
 * AddTempLayerTool — MMGIS plugin wrapper for AddTempLayerComponent.
 *
 * Bus channels consumed (request):
 *   layers:addLayer   (session-only layer add; lost on reload)
 *
 * Translates the component's onAddLayer callback into an event-bus request.
 * No direct core access — the plugin only talks to window.mmgisAPI.
 */
import React, { useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { AddTempLayerComponent } from './AddTempLayerComponent'
import { buildLayerObj } from './addTempLayerHelpers'

// Bridges the standalone component to MMGIS via the event bus.
function ConnectedAddTempLayer() {
    const onAddLayer = useCallback((input) => {
        const layerObj = buildLayerObj(input)
        if (!layerObj) {
            return Promise.reject(new Error('Invalid or unrecognized layer URL'))
        }
        const api = window.mmgisAPI
        if (!api?.request) return Promise.reject(new Error('mmgisAPI unavailable'))
        // Generic layers:addLayer — shows in the Layers panel, lost on reload.
        return api.request('layers:addLayer', layerObj)
    }, [])

    return <AddTempLayerComponent onAddLayer={onAddLayer} />
}

// Mounts the React tree into the panel target MMGIS assigns via make(targetId).
function InterfaceWithMMGIS(targetId) {
    const target = document.getElementById(targetId)
    if (!target) {
        this.separateFromMMGIS = () => {}
        return
    }

    const root = createRoot(target)
    root.render(<ConnectedAddTempLayer />)

    this.separateFromMMGIS = () => {
        root.unmount()
    }
}

const AddTempLayerTool = {
    height: 0,
    width: 300,
    targetId: null,
    MMGISInterface: null,
    made: false,

    make(targetId) {
        this.targetId = targetId
        this.MMGISInterface = new InterfaceWithMMGIS(targetId)
        this.made = true
    },

    destroy() {
        if (this.MMGISInterface) this.MMGISInterface.separateFromMMGIS()
        this.MMGISInterface = null
        this.made = false
    },

    getUrlString() {
        return ''
    },
}

export default AddTempLayerTool
