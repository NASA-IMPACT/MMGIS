import { useCallback, useEffect, useState } from 'react'
import { mmgisOn } from '../../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../../_shared/adapters/useMMGISHandlerReady'
import { getVisibleLayerOptions } from './getVisibleLayers'
import type { LayerOption } from '../lib/types'

export type VisibleLayers = {
    layers: LayerOption[]
    /**
     * False until the first read resolves: until then an empty `layers` means
     * "not read yet" rather than "none visible".
     */
    read: boolean
}

/**
 * Returns the currently-visible layers as dropdown options and keeps them in
 * sync with the map. Waits for the `layers:getAllConfigs` handler (registered
 * asynchronously during mission load) before the first read, then refreshes on
 * layer visibility / status changes.
 */
export const useVisibleLayers = (): VisibleLayers => {
    const [state, setState] = useState<VisibleLayers>({
        layers: [],
        read: false,
    })

    const refresh = useCallback(async () => {
        try {
            setState({ layers: await getVisibleLayerOptions(), read: true })
        } catch (err) {
            console.warn('[Comparison] failed to read visible layers', err)
        }
    }, [])

    useMMGISHandlerReady('layers:getAllConfigs', refresh)

    useEffect(() => {
        const cleanups = [
            mmgisOn('layer:visibilityChange', refresh),
            mmgisOn('layer:refreshStatusChange', refresh),
        ]
        return () => cleanups.forEach((off) => off())
    }, [refresh])

    return state
}
