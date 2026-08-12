import React from 'react'
import { useState, useCallback } from 'react'
import { LayerManagerPanel } from './lib'
import type { Layer } from './lib/types'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { getVisibleLayersWithLegends } from './adapters/getVisibleLayersWithLegends'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
} from './adapters/handlers'

type ToolVars = { showOnlyVisible?: boolean; width?: number }

// Panel controls are event callbacks and cannot await the requests they fire,
// so a rejected one would surface only as an unhandled rejection. Log it
// against the action that produced it instead.
const report = (action: string, result: Promise<void>): void => {
    result.catch((err) => {
        console.error(`LayerManager: ${action} failed`, err)
    })
}

export function MMGISLayerManagerAdapter() {
    const [layers, setLayers] = useState<Layer[]>([])
    const [loading, setLoading] = useState(true)
    const toolVars = useMMGISToolVars<ToolVars>('layermanager')

    const refresh = useCallback(async () => {
        try {
            const data = await getVisibleLayersWithLegends({
                showOnlyVisible: toolVars.showOnlyVisible === true,
            })
            setLayers(data)
        } catch (err) {
            console.error('LayerManager: refresh failed', err)
            setLayers([])
        } finally {
            setLoading(false)
        }
    }, [toolVars.showOnlyVisible])

    useMMGISEvent('layer:visibilityChange', refresh)
    useMMGISEvent('layer:refreshStatusChange', refresh)
    useMMGISEvent('layer:opacityChange', refresh)
    useMMGISEvent('layer:listedChange', refresh)
    useMMGISEvent('layers:listChanged', refresh)

    // 'layers:getAll' is registered by Layers_.fina() during mission load.
    // Wait for it before doing the initial refresh, otherwise the adapter
    // mounts to an empty list and never recovers (no event fires when the
    // mission's layers first become available).
    useMMGISHandlerReady('layers:getAll', refresh)

    return (
        <LayerManagerPanel
            layers={layers}
            loading={loading}
            onVisibilityChange={(id) => { report('toggleVisibility', toggleVisibility(id)) }}
            onOpacityChange={(id, op) => { report('setOpacity', setOpacity(id, op)) }}
            onColormapChange={(id, cm) => { report('setColormap', setColormap(id, cm, refresh)) }}
            onRescaleChange={(id, mn, mx) => { report('setRescale', setRescale(id, mn, mx, refresh)) }}
        />
    )
}
