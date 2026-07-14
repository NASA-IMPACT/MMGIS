import React from 'react'
import { useState, useCallback } from 'react'
import { LayerManagerPanel } from './lib'
import type { Layer } from './lib/types'
import { useMMGISEvent } from './adapters/useMMGISEvent'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { mmgisEmit } from '../_shared/adapters/mmgisAPI'
import { getVisibleLayersWithLegends } from './adapters/getVisibleLayersWithLegends'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
} from './adapters/handlers'

type ToolVars = { showOnlyVisible?: boolean; width?: number }

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
            onVisibilityChange={(id) => { void toggleVisibility(id) }}
            onOpacityChange={(id, op) => { void setOpacity(id, op) }}
            onColormapChange={(id, cm) => { void setColormap(id, cm, refresh) }}
            onRescaleChange={(id, mn, mx) => { void setRescale(id, mn, mx, refresh) }}
            onCompareLayer={(id) => {
                // Hand off to the independent Comparison plugin via the event
                // bus — LayerManager never imports it directly.
                mmgisEmit('plugin:comparison:startWithLayer', { layerId: id })
            }}
            onAddLayer={() => {
                // Reveal the AddTempLayer plugin (its overlay is the tool).
                // LayerManager never imports it directly.
                mmgisEmit('core:showPlugin', { pluginId: 'AddTempLayerTool' })
            }}
        />
    )
}
