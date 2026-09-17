import {
    mmgisGetCogCapabilities,
    mmgisGetLayerOrder,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
} from '../../_shared/adapters/mmgisAPI'
import {
    getLayersWithLegends,
    type LayerWithLegend,
} from '../../_shared/legend/getLayersWithLegends'
import { sortByOrder } from '../lib/utils/layerOrder'
import type { CogData, Layer } from '../lib/types'

export type FetchOptions = { showOnlyVisible?: boolean }

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
    layer: LayerWithLegend,
    titilerUrl: string | null,
): CogData | null => {
    if (capabilities?.hasColormap !== true || layer.colormap == null) return null
    return {
        editable: capabilities.canChangeColormap === true,
        colormap: layer.colormap,
        titilerUrl,
    }
}

/**
 * The panel's rows: the shared layers-with-legends assembly, plus the colormap
 * controls only this panel offers, in the order the map draws them.
 */
export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const [layers, cogCapabilities, titilerUrls, order] = await Promise.all([
        getLayersWithLegends({ showOnlyVisible }),
        mmgisGetCogCapabilities(),
        mmgisGetTiTilerUrls(),
        mmgisGetLayerOrder(),
    ])

    const result: Layer[] = layers.map((layer) => ({
        ...layer,
        cog: buildCogData(
            cogCapabilities?.[layer.id],
            layer,
            titilerUrls?.[layer.id] ?? null,
        ),
    }))
    // Top first as the map draws; config order against a core with no order.
    return sortByOrder(result, order)
}
