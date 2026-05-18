import { useState, useCallback, useEffect } from 'react'
import { LayerManagerPanel } from './lib'
import type { Layer } from './lib/types'
import { useMMGISEvent } from './adapters/useMMGISEvent'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import { getVisibleLayersWithLegends } from './adapters/getVisibleLayersWithLegends'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
    resetCog,
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

    useEffect(() => {
        refresh()
    }, [refresh])

    return (
        <LayerManagerPanel
            layers={layers}
            loading={loading}
            onRefresh={refresh}
            onVisibilityChange={(id) => { void toggleVisibility(id) }}
            onOpacityChange={(id, op) => { void setOpacity(id, op) }}
            onColormapChange={(id, cm) => { void setColormap(id, cm, refresh) }}
            onRescaleChange={(id, mn, mx) => { void setRescale(id, mn, mx, refresh) }}
            onCogReset={(id) => { void resetCog(id, refresh) }}
        />
    )
}
