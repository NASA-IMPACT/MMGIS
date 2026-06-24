// Compute the matched layer set for the active theme + selections and announce
// it on the bus. Per current scope we only EMIT (and log) — nothing changes
// layers; LayerManager will consume `layerFilter:changed` later.
import { mmgisRequest, mmgisEmit } from '../../_shared/adapters/mmgisAPI'
import { matchLayers, type LayerLike } from '../lib/utils/matchLayers'
import type { FilterSelections } from '../lib/types'

export interface FilterChangePayload {
    themeId: string
    selections: FilterSelections
    matchedLayerNames: string[]
}

export async function emitFilterChange(
    themeProperty: string,
    themeId: string,
    selections: FilterSelections,
): Promise<FilterChangePayload> {
    const configs = await mmgisRequest<Record<string, LayerLike>>(
        'layers:getAllConfigs',
    )
    const matchedLayerNames = matchLayers(
        configs,
        themeProperty,
        themeId,
        selections,
    )
    const payload: FilterChangePayload = { themeId, selections, matchedLayerNames }
    mmgisEmit('layerFilter:changed', payload)
    // Visibility for now (LayerManager isn't wired to react yet).
    console.log('[LayerFilter] layerFilter:changed', payload)
    return payload
}
