/**
 * AddTempLayerTool — MMGIS plugin wrapper for AddTempLayerComponent.
 *
 * Scaffold only. The wrapper will later translate the component's onAddLayer
 * callback into mmgisAPI.addLayer(...) (session-only, lost on reload).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AddTempLayerComponent } from './AddTempLayerComponent'

// Bridges the standalone component to MMGIS. No wiring yet.
function ConnectedAddTempLayer() {
    return <AddTempLayerComponent />
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
