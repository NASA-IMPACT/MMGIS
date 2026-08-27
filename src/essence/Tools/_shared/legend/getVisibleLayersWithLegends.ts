import {
    mmgisRequest,
    mmgisGetCogCapabilities,
    mmgisGetListedLayers,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
} from '../adapters/mmgisAPI'
import { buildLayerLegendData } from './buildLayerLegendData'
import type { Layer } from './types'

export type FetchOptions = {
    showOnlyVisible?: boolean
    // A caller that already fetched layers:getAllConfigs for its own
    // purposes (e.g. the export model's view-aware filtering) can pass it
    // through here instead of this module hitting the bus for it again.
    layerConfigs?: Record<string, Record<string, unknown>> | null
}

export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
    layerConfigs: providedLayerConfigs,
}: FetchOptions = {}): Promise<Layer[]> => {
    const layerConfigs =
        providedLayerConfigs !== undefined
            ? providedLayerConfigs
            : await mmgisRequest<Record<string, Record<string, unknown>>>(
                  'layers:getAllConfigs',
              )
    if (!layerConfigs) return []

    const [visibleLayers, opacities, listed, cogCapabilities, titilerUrls] = await Promise.all([
        mmgisRequest<Record<string, boolean>>('layers:getVisible'),
        mmgisRequest<Record<string, number>>('layers:getAllOpacities'),
        mmgisGetListedLayers(),
        mmgisGetCogCapabilities(),
        mmgisGetTiTilerUrls(),
    ])

    // No visibility map means core answered nothing — not that every layer is
    // off. Reading it as "all hidden" would drop every row and leave the
    // export with no band at all, so visibility counts as unknown and nothing
    // is filtered on it.
    const visibilityKnown = visibleLayers != null
    if (showOnlyVisible && !visibilityKnown) {
        console.warn(
            '[legend] core reported no layer visibility; keeping every layer',
        )
    }

    const result: Layer[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
        if (listed?.[layerName] === false) continue
        const isVisible = visibilityKnown
            ? visibleLayers?.[layerName] === true
            : true
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
