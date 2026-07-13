import React, { useCallback } from 'react'
import { AddTempLayerPanel } from './lib'
import type { AddTempLayerInput } from './lib'
import { buildLayerObj } from './adapters/buildLayerObj'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'

/**
 * Bridges the portable AddTempLayerPanel to MMGIS via the event bus. The panel
 * owns its own form state; this adapter only turns a submitted input into a
 * `layers:addLayer` request (session-only add; lost on reload).
 */
export function MMGISAddTempLayerAdapter() {
    const onAddLayer = useCallback((input: AddTempLayerInput) => {
        const layerObj = buildLayerObj(input)
        if (!layerObj) {
            return Promise.reject(new Error('Invalid or unrecognized layer URL'))
        }
        return mmgisRequest('layers:addLayer', layerObj)
    }, [])

    return <AddTempLayerPanel onAddLayer={onAddLayer} />
}
