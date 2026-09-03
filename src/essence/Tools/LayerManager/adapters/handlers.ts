import {
    mmgisRequest,
    mmgisEmit,
    mmgisShowPlugin,
    mmgisGetLayerCogCapabilities,
    mmgisGetLayerBounds,
    mmgisFitBounds,
} from '../../_shared/adapters/mmgisAPI'
import {
    ZOOM_TO_LAYER_PADDING,
    ZOOM_TO_LAYER_POINT_MAX_ZOOM,
} from '../lib/utils/constants'

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

/**
 * Moves the map to a layer's extent.
 *
 * Does nothing for a layer with no extent to move to. The menu offering this
 * asks core for the same bounds when it opens and disables the item in that
 * case, so the check here is what keeps a stale menu from moving the map
 * somewhere arbitrary.
 *
 * The fit is capped only for an extent enclosing no area. Anything with area
 * fits as far in as it goes, so a layer covering a few hundred metres is not
 * held back to the zoom a point layer needs.
 */
export const zoomToLayer = async (layerId: string): Promise<void> => {
    const bounds = await mmgisGetLayerBounds(layerId)
    if (bounds === null) {
        // Reachable only when the layer lost its extent between the menu
        // resolving it and the click. The panel has no channel for saying so,
        // which leaves the log as the sole trace of a click that led nowhere.
        console.warn(`LayerManager: '${layerId}' has no extent to zoom to`)
        return
    }
    const [[south, west], [north, east]] = bounds
    const enclosesNoArea = south === north && west === east
    await mmgisFitBounds(bounds, {
        padding: ZOOM_TO_LAYER_PADDING,
        ...(enclosesNoArea ? { maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM } : {}),
    })
}

/**
 * Hands a layer to the Comparison plugin as the first of the two sides it
 * swipes between. A mission without that plugin has nobody listening.
 */
export const compareLayer = (layerId: string): void => {
    mmgisEmit('plugin:comparison:startWithLayer', { layerId })
}

export const ADD_LAYER_PLUGIN_ID = 'AddTempLayerTool'

/** Reveals the "add layer from URL" form. */
export const showAddLayer = (): void => {
    // Widened from CommandResult: without strictNullChecks a boolean
    // discriminant does not narrow, so `reason` is unreachable on the union.
    mmgisShowPlugin(ADD_LAYER_PLUGIN_ID)
        .then((result: { ok: boolean; reason?: string }) => {
            if (!result.ok) {
                console.warn(`LayerManager: showAddLayer refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('LayerManager: showAddLayer failed', err))
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

