import {
    mmgisGetCogCapabilities,
    mmgisGetDataCoverage,
    mmgisGetLayerConfigs,
    mmgisGetListedLayers,
    mmgisGetTiTilerUrls,
    type CogCapabilities,
    type LayerConfig,
} from '../../_shared/adapters/mmgisAPI'
import { getLayersWithLegends } from '../../_shared/legend/getLayersWithLegends'
import type { CogData, Layer } from '../lib/types'

export type FetchOptions = { showOnlyVisible?: boolean }

/**
 * Whether a layer offers area analysis, read from the same mission-config flag
 * the analysis plugins gate on. Nothing about a layer's data or type implies
 * it — the layer opts in through its configuration.
 */
const supportsAnalysis = (cfg: LayerConfig | undefined): boolean =>
    (
        cfg?.variables as
            | { analysis?: { is_analysis_supported?: boolean } }
            | undefined
    )?.analysis?.is_analysis_supported === true

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
 * controls and the out-of-range and analysis marks only this panel offers.
 */
export const getVisibleLayersWithLegends = async ({
    showOnlyVisible = false,
}: FetchOptions = {}): Promise<Layer[]> => {
    // The configs are asked for once: the analysis mark reads them here, and
    // the row assembly is handed them rather than requesting them again.
    const layerConfigs = await mmgisGetLayerConfigs()
    // Coverage is read with the rest, so a layer core is already holding back
    // for lack of data is flagged on the first render rather than at the next
    // change core announces.
    const [layers, listed, cogCapabilities, titilerUrls, coverage] =
        await Promise.all([
            getLayersWithLegends({ showOnlyVisible, layerConfigs }),
            mmgisGetListedLayers(),
            mmgisGetCogCapabilities(),
            mmgisGetTiTilerUrls(),
            mmgisGetDataCoverage(),
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
            outOfDataRange: coverage?.[layer.id]?.outOfDataRange === true,
            analysisSupported: supportsAnalysis(layerConfigs?.[layer.id]),
        }))
}
