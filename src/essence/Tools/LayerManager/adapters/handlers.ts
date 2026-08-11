import {
    mmgisRequest,
    mmgisEmit,
    mmgisGetLayerCogCapabilities,
} from '../../_shared/adapters/mmgisAPI'

type Refresh = () => Promise<void> | void

/**
 * Whether core accepts a colormap or rescale change for this layer, by its
 * config shape and tile source. The same verdict makes the controls editable
 * in the legend, so a write is only sent for a layer core can recompile.
 */
const canChangeColormap = async (layerId: string): Promise<boolean> => {
    const capabilities = await mmgisGetLayerCogCapabilities(layerId)
    return capabilities?.canChangeColormap === true
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
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogColormap: colormap } })
    // applyCogFieldsToUrl prefers `currentCogColormap` over the mission-configured
    // `cogColormap`, so the override key has to match the config write above.
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogColormap: colormap } })
    mmgisEmit('layer:cogColormapChange', { layerName: layerId, colormap })
    await refresh()
}

export const setRescale = async (
    layerId: string,
    min: number,
    max: number,
    refresh: Refresh,
): Promise<void> => {
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogMin: min, currentCogMax: max } })
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogMin: min, currentCogMax: max } })
    mmgisEmit('layer:cogRescaleChange', { layerName: layerId, min, max })
    await refresh()
}

