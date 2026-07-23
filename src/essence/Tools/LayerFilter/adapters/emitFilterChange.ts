// Compute the matched layer set for the active theme + selections, announce it
// on the bus, and — once the user has actually interacted with the filter —
// apply it to the layers list via the core's `layers:setListed` channel
// (matched → listed, everything else → unlisted). Before first interaction we
// only announce, so the app boots with the full layers list. The layer configs
// are passed in (the adapter loads them once for both matching and option
// derivation).
import { mmgisEmit, mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import {
    matchLayers,
    buildListedUpdates,
    type LayerLike,
} from '../lib/utils/matchLayers'
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
    applyToList: boolean,
): FilterChangePayload {
    const matchedLayerNames = matchLayers(
        layerConfigs,
        themeProperty,
        themeId,
        selections,
    )
    const payload: FilterChangePayload = { themeId, selections, matchedLayerNames }
    mmgisEmit('layerFilter:changed', payload)
    if (applyToList) {
        void mmgisRequest('layers:setListed', {
            updates: buildListedUpdates(layerConfigs, matchedLayerNames),
            source: 'layerFilter',
        })
    }
    return payload
}
