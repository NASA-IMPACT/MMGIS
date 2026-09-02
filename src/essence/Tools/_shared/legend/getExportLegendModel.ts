import { getVisibleLayersWithLegends } from './getVisibleLayersWithLegends'
import { resolveColormapColors } from './resolveColormapColors'
import { filterLayersForExportView } from './filterLayersForExportView'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeEnd,
    mmgisFormatTime,
    type LayerConfig,
} from '../adapters/mmgisAPI'
import type { Layer, CategoricalStop } from './types'

export type ExportLegendRow =
    | {
          kind: 'gradient'
          title: string
          timeRange: string | null
          colors: string[] | null
          min: number | string | null
          max: number | string | null
          unit: string | null
      }
    | {
          kind: 'categorical'
          title: string
          timeRange: string | null
          stops: CategoricalStop[]
      }

export type ExportLegendModel = {
    missionName: string | null
    rows: ExportLegendRow[]
}

// The time placeholders core substitutes into a layer's URL. A layer whose
// URL carries none of them requests the same scene wherever the cursor sits,
// so its pixels do not vary with time even when `time.enabled` is true.
const TIME_PLACEHOLDER = /\{(?:start|end)?time\}|\{customtime\.\d+\}/

type TimeWindow = { start: string | null; end: string | null }

/**
 * The time window a layer's pixels actually answer to, or null when the layer
 * does not vary with time — which is also the answer for anything unrecognized.
 * An absent range is always safe; a wrong one reads as an acquisition time the
 * layer never had.
 */
const layerTimeWindow = (
    cfg: LayerConfig | undefined,
    globalWindow: TimeWindow,
): TimeWindow | null => {
    const time = cfg?.time
    if (time?.enabled !== true) return null
    if (typeof cfg?.url !== 'string' || !TIME_PLACEHOLDER.test(cfg.url))
        return null
    if (time.type === 'local')
        return { start: time.start ?? null, end: time.end ?? null }
    if (time.type === 'global' || time.type === 'requery') return globalWindow
    return null
}

const globalTimeWindow = async (): Promise<TimeWindow> => {
    try {
        const [start, end] = await Promise.all([
            mmgisGetTimeStart(),
            mmgisGetTimeEnd(),
        ])
        return { start, end }
    } catch (err) {
        console.warn('[export legend] core reported no global time window', err)
        return { start: null, end: null }
    }
}

/**
 * Formats through core (`time:formatTime`) so a range on the band reads the
 * same way as the mission's own time UI, and so the d3-vs-moment rule behind
 * that lives in exactly one place. Repeated timestamps — the global window
 * shared by every global row — are requested once.
 */
const missionTimeFormatter = (): ((
    time: string,
) => Promise<string | null>) => {
    const pending = new Map<string, Promise<string | null>>()
    return (time: string) => {
        const cached = pending.get(time)
        if (cached) return cached
        const request = mmgisFormatTime(time)
        pending.set(time, request)
        return request
    }
}

/**
 * A window as `start → end`, never a lone endpoint: a single timestamp on a
 * legend reads as the moment the data was captured, which a composited range
 * is not. Null whenever either end is missing or unformattable, so a row
 * claims nothing rather than half a range.
 */
const formatTimeRange = async (
    timeWindow: TimeWindow | null,
    formatTime: (time: string) => Promise<string | null>,
): Promise<string | null> => {
    if (!timeWindow?.start || !timeWindow.end) return null
    try {
        const [start, end] = await Promise.all([
            formatTime(timeWindow.start),
            formatTime(timeWindow.end),
        ])
        if (!start || !end) return null
        return `${start} → ${end}`
    } catch (err) {
        console.warn('[export legend] could not format a layer time range', err)
        return null
    }
}

// A manually authored legend (variables.legend / legend CSV) is the layer's
// legend, full stop — even when the layer also carries a live cog colormap.
// The auto-derived colormap/rescale bar only stands in when nothing was
// authored. Layers with neither are omitted entirely.
const toRow = async (
    layer: Layer,
    timeRange: string | null,
): Promise<ExportLegendRow | null> => {
    if (layer.type === 'categorical' && layer.categoricalStops?.length) {
        return {
            kind: 'categorical',
            title: layer.title,
            timeRange,
            stops: layer.categoricalStops,
        }
    }
    if (layer.type === 'gradient' && layer.stops?.length) {
        return {
            kind: 'gradient',
            title: layer.title,
            timeRange,
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
            timeRange,
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
    // layerConfigs is fetched once here and threaded into
    // getVisibleLayersWithLegends below, rather than each independently
    // requesting layers:getAllConfigs from core.
    const [layerConfigs, viewState, globalWindow] = await Promise.all([
        mmgisGetLayerConfigs(),
        mmgisGetViewState(),
        globalTimeWindow(),
    ])
    const layers = await getVisibleLayersWithLegends({
        showOnlyVisible: true,
        layerConfigs,
    })
    // Drops the layers that paint nothing (opacity 0); panel/LayerManager
    // listings stay unfiltered, so this is export-only.
    const legendLayers = filterLayersForExportView(layers)
    const formatTime = missionTimeFormatter()
    const rows = (
        await Promise.all(
            legendLayers.map(async (layer) =>
                toRow(
                    layer,
                    await formatTimeRange(
                        layerTimeWindow(layerConfigs?.[layer.id], globalWindow),
                        formatTime,
                    ),
                ),
            ),
        )
    ).filter((row): row is ExportLegendRow => row !== null)
    return {
        missionName: viewState?.missionName ?? null,
        rows,
    }
}
