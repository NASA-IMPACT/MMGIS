/**
 * Comparison data orchestrator — pulls the source data the tool reflects.
 *
 * Reads the currently-visible layers from the layer registry via the mmgisAPI
 * event bus and shapes them into the lib/'s `LayerOption` props.
 */
import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import type { LayerOption } from '../lib/types'

type LayerConfig = { type?: string; display_name?: string }

/**
 * Read the currently-visible layers as dropdown options, in config order.
 * Header layers are excluded — they are not comparable.
 */
export const getVisibleLayerOptions = async (): Promise<LayerOption[]> => {
    const configs = await mmgisRequest<Record<string, LayerConfig>>('layers:getAllConfigs')
    const visible = await mmgisRequest<Record<string, boolean>>('layers:getVisible')
    if (!configs) return []

    const options: LayerOption[] = []
    for (const layerName of Object.keys(configs)) {
        const cfg = configs[layerName]
        if (!cfg || cfg.type === 'header') continue
        if (visible?.[layerName] !== true) continue
        options.push({ id: layerName, title: cfg.display_name || layerName })
    }
    return options
}
