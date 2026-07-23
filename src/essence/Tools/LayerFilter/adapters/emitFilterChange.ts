// Announce the engine's result on the bus and — once the user has actually
// interacted with the filter — apply it to the layers list via the core's
// `layers:setListed` channel (matched → listed, everything else → unlisted).
// Before first interaction we only announce, so the app boots with the full
// layers list.
import { mmgisEmit, mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import { buildListedUpdates, type LayerLike } from '../lib/utils/listedUpdates'
import type { FilterSelections } from '../lib/types'

export interface FilterChangePayload {
    themeId: string
    selections: FilterSelections
    matchedLayerNames: string[]
}

export function emitFilterChange(
    themeId: string,
    selections: FilterSelections,
    matchedLayerNames: string[],
    layerConfigs: Record<string, LayerLike> | null | undefined,
    applyToList: boolean,
): FilterChangePayload {
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
