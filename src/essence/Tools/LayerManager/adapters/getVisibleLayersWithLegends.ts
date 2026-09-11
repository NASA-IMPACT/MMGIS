import {
    mmgisRequest,
    mmgisGetCogCapabilities,
    mmgisGetDataCoverage,
    mmgisGetListedLayers,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
} from '../../_shared/adapters/mmgisAPI'
import { buildLayerLegendData } from './buildLayerLegendData'
import type { Layer } from '../lib/types'

export type FetchOptions = { showOnlyVisible?: boolean }

export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const layerConfigs = await mmgisRequest<Record<string, Record<string, unknown>>>('layers:getAllConfigs')
    if (!layerConfigs) return []

    // Coverage is read with the rest, so a layer core is already holding back
    // for lack of data is flagged on the first render rather than at the next
    // change core announces.
    const [visibleLayers, opacities, listed, cogCapabilities, titilerUrls, coverage] =
        await Promise.all([
            mmgisRequest<Record<string, boolean>>('layers:getVisible'),
            mmgisRequest<Record<string, number>>('layers:getAllOpacities'),
            mmgisGetListedLayers(),
            mmgisGetCogCapabilities(),
            mmgisGetTiTilerUrls(),
            mmgisGetDataCoverage(),
        ])

    const result: Layer[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
        if (listed?.[layerName] === false) continue
        const isVisible = visibleLayers?.[layerName] === true
        if (showOnlyVisible && !isVisible) continue
        result.push({
            ...buildLayerLegendData(
                layerName,
                cfg as Parameters<typeof buildLayerLegendData>[1],
                opacities ?? null,
                isVisible,
                cogCapabilities?.[layerName] as CogCapabilities | undefined,
                titilerUrls?.[layerName] ?? null,
            ),
            dataCoverage: coverage?.[layerName] ?? null,
        })
    }
    return result
}
