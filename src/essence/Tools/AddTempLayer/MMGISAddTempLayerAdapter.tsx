import React, { useCallback } from 'react'
import { AddTempLayerPanel } from './lib'
import type { AddTempLayerInput } from './lib'
import { buildLayerObj } from './adapters/buildLayerObj'
import { mmgisRequest, mmgisEmit } from '../_shared/adapters/mmgisAPI'

const PLUGIN_ID = 'AddTempLayerTool'

export type MMGISAddTempLayerAdapterProps = {
    /** Mount container the modal should portal into (the tool's target). */
    portalContainer?: HTMLElement | null
}

/**
 * Bridges the portable AddTempLayerPanel to MMGIS via the event bus. The panel
 * owns its own form state; this adapter only turns a submitted input into a
 * `layers:addLayer` request (session-only add; lost on reload). The overlay is
 * the tool itself — the ✕ hides the plugin (LayerManager's button shows it).
 */
export function MMGISAddTempLayerAdapter({
    portalContainer,
}: MMGISAddTempLayerAdapterProps = {}) {
    const onAddLayer = useCallback((input: AddTempLayerInput) => {
        const layerObj = buildLayerObj(input)
        if (!layerObj) {
            return Promise.reject(new Error('Invalid or unrecognized layer URL'))
        }
        return mmgisRequest('layers:addLayer', layerObj)
    }, [])

    const onClose = useCallback(() => {
        mmgisEmit('core:hidePlugin', { pluginId: PLUGIN_ID })
    }, [])

    return (
        <AddTempLayerPanel
            onAddLayer={onAddLayer}
            onClose={onClose}
            portalContainer={portalContainer}
        />
    )
}
