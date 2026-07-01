// Compute the matched layer set for the active theme + selections and announce
// it on the bus. Per current scope we only EMIT (and log) — nothing changes
// layers; LayerManager will consume `layerFilter:changed` later. The layer
// configs are passed in (the adapter loads them once for both matching and
// option derivation).
import { mmgisEmit } from '../../_shared/adapters/mmgisAPI'
import { matchLayers, type LayerLike } from '../lib/utils/matchLayers'
import type { FilterSelections } from '../lib/types'

export interface FilterChangePayload {
    themeId: string
    selections: FilterSelections
    matchedLayerNames: string[]
}

export function emitFilterChange(
    themeProperty: string,
    themeId: string,
    selections: FilterSelections,
    layerConfigs: Record<string, LayerLike> | null | undefined,
): FilterChangePayload {
    const matchedLayerNames = matchLayers(
        layerConfigs,
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
