import {
    mmgisRequest,
    mmgisGetCogCapabilities,
    mmgisGetListedLayers,
    mmgisGetLayerOrder,
    mmgisGetLayerLegends,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
    type LayerLegend,
} from '../../_shared/adapters/mmgisAPI'
import { sortByOrder } from '../lib/utils/layerOrder'
import type { CogData, Layer } from '../lib/types'

export type FetchOptions = { showOnlyVisible?: boolean }

type LayerConfig = { display_name?: string; description?: string; type?: string }

/**
 * The colormap controls for one layer, or null when it has no ramp to control.
 *
 * `hasColormap` is what puts a ramp on the row; `canChangeColormap` is what
 * makes it editable. A layer can have the first without the second. The ramp's
 * name comes from the legend core resolved rather than from the raw config, so
 * the picker's selection and the bar beside it can never name different ramps.
 */
const buildCogData = (
    capabilities: CogCapabilities | undefined,
    legend: LayerLegend | undefined,
    titilerUrl: string | null,
): CogData | null => {
    if (capabilities?.hasColormap !== true || legend?.colormap == null) return null
    return {
        editable: capabilities.canChangeColormap === true,
        colormap: legend.colormap,
        titilerUrl,
    }
}

export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const layerConfigs = await mmgisRequest<Record<string, LayerConfig>>('layers:getAllConfigs')
    if (!layerConfigs) return []

    const [visibleLayers, opacities, listed, cogCapabilities, legends, titilerUrls, order] =
        await Promise.all([
            mmgisRequest<Record<string, boolean>>('layers:getVisible'),
            mmgisRequest<Record<string, number>>('layers:getAllOpacities'),
            mmgisGetListedLayers(),
            mmgisGetCogCapabilities(),
            mmgisGetLayerLegends(),
            mmgisGetTiTilerUrls(),
            mmgisGetLayerOrder(),
        ])

    const result: Layer[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
        if (listed?.[layerName] === false) continue
        const isVisible = visibleLayers?.[layerName] === true
        if (showOnlyVisible && !isVisible) continue

        // A core too old to answer leaves the row with no legend to draw
        // rather than with one this side guessed at.
        const legend = legends?.[layerName]
        result.push({
            id: layerName,
            title: cfg.display_name || layerName,
            description: cfg.description || null,
            opacity: opacities?.[layerName] ?? 1,
            visible: isVisible,
            type: legend?.type ?? 'none',
            stops: legend?.stops ?? null,
            min: legend?.min ?? null,
            max: legend?.max ?? null,
            unit: legend?.unit ?? null,
            categoricalStops: legend?.swatches ?? undefined,
            cog: buildCogData(
                cogCapabilities?.[layerName],
                legend,
                titilerUrls?.[layerName] ?? null,
            ),
        })
    }
    // Top first as the map draws; config order against a core with no order.
    return sortByOrder(result, order)
}
