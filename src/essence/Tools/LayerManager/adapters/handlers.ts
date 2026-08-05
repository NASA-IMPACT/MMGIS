import { mmgisRequest, mmgisEmit } from '../../_shared/adapters/mmgisAPI'

type Refresh = () => Promise<void> | void

type LayerConfig = {
    cogTransform?: boolean
    cogColormap?: string
    cogMin?: number
    cogMax?: number
    cogRendererMode?: string
}

export const toggleVisibility = async (layerId: string): Promise<void> => {
    const newVisibility = await mmgisRequest<boolean>('layers:toggle', layerId)
    if (newVisibility !== null) {
        mmgisEmit('layer:visibilityChange', { layerName: layerId, visible: newVisibility })
    }
}

export const setOpacity = async (layerId: string, opacity: number): Promise<void> => {
    const success = await mmgisRequest<boolean>('layers:setOpacity', { layerUUID: layerId, opacity })
    if (success) {
        mmgisEmit('layer:opacityChange', { layerName: layerId, opacity })
    }
}

export const setColormap = async (layerId: string, colormap: string, refresh: Refresh): Promise<void> => {
    const cfg = await mmgisRequest<LayerConfig>('layers:getConfig', layerId)
    const enabled = cfg && (cfg.cogTransform || cfg.cogRendererMode === 'deckRaster')
    if (!enabled) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogColormap: colormap } })
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { cogColormap: colormap } })
    mmgisEmit('layer:cogColormapChange', { layerName: layerId, colormap })
    await refresh()
}

export const setRescale = async (
    layerId: string,
    min: number,
    max: number,
    refresh: Refresh,
): Promise<void> => {
    const cfg = await mmgisRequest<LayerConfig>('layers:getConfig', layerId)
    const enabled = cfg && (cfg.cogTransform || cfg.cogRendererMode === 'deckRaster')
    if (!enabled) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogMin: min, currentCogMax: max } })
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogMin: min, currentCogMax: max } })
    mmgisEmit('layer:cogRescaleChange', { layerName: layerId, min, max })
    await refresh()
}

