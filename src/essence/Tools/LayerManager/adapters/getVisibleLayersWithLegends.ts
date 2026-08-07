import { mmgisRequest, mmgisGetColormapCapable } from '../../_shared/adapters/mmgisAPI'
import { buildLayerLegendData } from './buildLayerLegendData'
import type { Layer } from '../lib/types'

export type FetchOptions = { showOnlyVisible?: boolean }

export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const layerConfigs = await mmgisRequest<Record<string, Record<string, unknown>>>('layers:getAllConfigs')
    const visibleLayers = await mmgisRequest<Record<string, boolean>>('layers:getVisible')
    const opacities = await mmgisRequest<Record<string, number>>('layers:getAllOpacities')
    const colormapCapable = await mmgisGetColormapCapable()
    if (!layerConfigs) return []

    const result: Layer[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
        const isVisible = visibleLayers?.[layerName] === true
        if (showOnlyVisible && !isVisible) continue
        result.push(
            buildLayerLegendData(
                layerName,
                cfg as Parameters<typeof buildLayerLegendData>[1],
                opacities ?? null,
                isVisible,
                colormapCapable?.[layerName] === true,
            ),
        )
    }
    return result
}
