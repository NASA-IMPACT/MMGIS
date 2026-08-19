import {
    mmgisRequest,
    mmgisGetCogCapabilities,
    mmgisGetListedLayers,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
} from '../adapters/mmgisAPI'
import { buildLayerLegendData } from './buildLayerLegendData'
import type { Layer } from './types'

export type FetchOptions = { showOnlyVisible?: boolean }

export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const layerConfigs = await mmgisRequest<Record<string, Record<string, unknown>>>('layers:getAllConfigs')
    if (!layerConfigs) return []

    const [visibleLayers, opacities, listed, cogCapabilities, titilerUrls] = await Promise.all([
        mmgisRequest<Record<string, boolean>>('layers:getVisible'),
        mmgisRequest<Record<string, number>>('layers:getAllOpacities'),
        mmgisGetListedLayers(),
        mmgisGetCogCapabilities(),
        mmgisGetTiTilerUrls(),
    ])

    const result: Layer[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
        if (listed?.[layerName] === false) continue
        const isVisible = visibleLayers?.[layerName] === true
        if (showOnlyVisible && !isVisible) continue
        result.push(
            buildLayerLegendData(
                layerName,
                cfg as Parameters<typeof buildLayerLegendData>[1],
                opacities ?? null,
                isVisible,
                cogCapabilities?.[layerName] as CogCapabilities | undefined,
                titilerUrls?.[layerName] ?? null,
            ),
        )
    }
    return result
}
