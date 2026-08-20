import { getVisibleLayersWithLegends } from './getVisibleLayersWithLegends'
import { resolveColormapColors } from './resolveColormapColors'
import { filterLayersForExportView } from './filterLayersForExportView'
import {
    mmgisGetViewState,
    mmgisIsTimeEnabled,
    mmgisGetCurrentTimeFormatted,
    mmgisGetLayerConfigs,
    mmgisGetMapBounds,
    mmgisGetMapZoom,
    mmgisGetAllLayerBounds,
} from '../adapters/mmgisAPI'
import type { Layer, CategoricalStop } from './types'

export type ExportLegendRow =
    | {
          kind: 'gradient'
          title: string
          colors: string[] | null
          min: number | string | null
          max: number | string | null
          unit: string | null
      }
    | { kind: 'categorical'; title: string; stops: CategoricalStop[] }

export type ExportLegendModel = {
    missionName: string | null
    timeLabel: string | null
    rows: ExportLegendRow[]
}

// A manually authored legend (variables.legend / legend CSV) is the layer's
// legend, full stop — even when the layer also carries a live cog colormap.
// The auto-derived colormap/rescale bar only stands in when nothing was
// authored. Layers with neither are omitted entirely.
const toRow = async (layer: Layer): Promise<ExportLegendRow | null> => {
    if (layer.type === 'categorical' && layer.categoricalStops?.length) {
        return {
            kind: 'categorical',
            title: layer.title,
            stops: layer.categoricalStops,
        }
    }
    if (layer.type === 'gradient' && layer.stops?.length) {
        return {
            kind: 'gradient',
            title: layer.title,
            colors: layer.stops,
            min: layer.min ?? null,
            max: layer.max ?? null,
            unit: layer.unit?.label ?? layer.cog?.units ?? null,
        }
    }
    if (layer.type === 'gradient' && layer.cog) {
        return {
            kind: 'gradient',
            title: layer.title,
            colors: await resolveColormapColors(
                layer.cog.colormap,
                layer.cog.titilerUrl,
            ),
            min: layer.cog.min,
            max: layer.cog.max,
            unit: layer.cog.units ?? null,
        }
    }
    return null
}

export const getExportLegendModel = async (): Promise<ExportLegendModel> => {
    const [
        layers,
        viewState,
        timeEnabled,
        formattedTime,
        layerConfigs,
        viewportBounds,
        zoom,
        layerBounds,
    ] = await Promise.all([
        getVisibleLayersWithLegends({ showOnlyVisible: true }),
        mmgisGetViewState(),
        mmgisIsTimeEnabled(),
        mmgisGetCurrentTimeFormatted(),
        mmgisGetLayerConfigs(),
        mmgisGetMapBounds(),
        mmgisGetMapZoom(),
        mmgisGetAllLayerBounds(),
    ])
    // Narrows the toggled-on layers down to ones actually visible in the
    // current viewport — panel/LayerManager listings stay unfiltered; this
    // is export-only. Any signal core couldn't answer (no viewport, no
    // zoom, no bounds for a layer) keeps that layer rather than dropping it.
    const inViewLayers = filterLayersForExportView(layers, {
        layerConfigs,
        viewportBounds,
        zoom,
        layerBounds,
    })
    const rows = (await Promise.all(inViewLayers.map(toRow))).filter(
        (row): row is ExportLegendRow => row !== null,
    )
    return {
        missionName: viewState?.missionName ?? null,
        // Prefer the mission-formatted time; fall back to the raw ISO string
        // viewState carries against a core that predates time:getCurrentFormatted.
        timeLabel:
            timeEnabled === true && viewState?.time
                ? formattedTime ?? viewState.time
                : null,
        rows,
    }
}
