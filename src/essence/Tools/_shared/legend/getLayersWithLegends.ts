import {
    mmgisRequest,
    mmgisGetLayerLegends,
    mmgisGetLayerOrder,
    type LegendType,
    type LegendSwatch,
} from '../adapters/mmgisAPI'
import { sortByOrder } from './sortByOrder'

/**
 * A layer of the mission, carrying the legend core resolved for it. Every
 * legend field is core's answer copied as it stands — nothing here rebuilds a
 * legend, derives bounds or resolves a ramp.
 */
export type LayerWithLegend = {
    id: string
    title: string
    description: string | null
    opacity: number
    visible: boolean
    type: LegendType
    // gradient fields
    stops?: string[] | null
    /** Null where the layer declares no bound; labels render blank rather than 0. */
    min?: number | null
    max?: number | null
    unit?: { label: string } | null
    // categorical fields
    categoricalStops?: LegendSwatch[]
    /** The ramp the gradient was sampled from, for a consumer that names it. */
    colormap?: string | null
}

export type LayerFetchOptions = { showOnlyVisible?: boolean }

type LayerConfig = { display_name?: string; description?: string; type?: string }

/**
 * Every listed layer with its legend, keyed answers from core assembled onto
 * one row each. Shared by the Layers panel, which lists them, and by the
 * export legend band, which draws them — so the two can never disagree about
 * what is on the map or what it paints with.
 */
export const getLayersWithLegends = async ({
    showOnlyVisible = false,
}: LayerFetchOptions = {}): Promise<LayerWithLegend[]> => {
    const layerConfigs = await mmgisRequest<Record<string, LayerConfig>>('layers:getAllConfigs')
    if (!layerConfigs) return []

    const [visibleLayers, opacities, legends, order] = await Promise.all([
        mmgisRequest<Record<string, boolean>>('layers:getVisible'),
        mmgisRequest<Record<string, number>>('layers:getAllOpacities'),
        mmgisGetLayerLegends(),
        mmgisGetLayerOrder(),
    ])

    const result: LayerWithLegend[] = []
    for (const layerName of Object.keys(layerConfigs)) {
        const cfg = layerConfigs[layerName]
        if (!cfg) continue
        if (cfg.type === 'header') continue
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
            colormap: legend?.colormap ?? null,
        })
    }
    // Top first as the map draws; config order against a core with no order.
    return sortByOrder(result, order)
}
