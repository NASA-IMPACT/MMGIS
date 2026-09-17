import {
    mmgisGetCogCapabilities,
    mmgisGetListedLayers,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
} from '../../_shared/adapters/mmgisAPI'
import { getLayersWithLegends } from '../../_shared/legend/getLayersWithLegends'
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
    colormap: string | null | undefined,
    titilerUrl: string | null,
): CogData | null => {
    if (capabilities?.hasColormap !== true || colormap == null) return null
    return {
        editable: capabilities.canChangeColormap === true,
        colormap,
        titilerUrl,
    }
}

/**
 * The panel's rows: the shared layers-with-legends assembly, minus the layers
 * something has filtered out of the lists (the LayerFilter plugin's doing —
 * they still paint, so an export still legends them), plus the colormap
 * controls only this panel offers.
 */
export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    const [layers, listed, cogCapabilities, titilerUrls] = await Promise.all([
        getLayersWithLegends({ showOnlyVisible }),
        mmgisGetListedLayers(),
        mmgisGetCogCapabilities(),
        mmgisGetTiTilerUrls(),
    ])

    return layers
        .filter((layer) => listed?.[layer.id] !== false)
        .map(({ colormap, ...layer }) => ({
            ...layer,
            cog: buildCogData(
                cogCapabilities?.[layer.id],
                colormap,
                titilerUrls?.[layer.id] ?? null,
            ),
        }))
}
