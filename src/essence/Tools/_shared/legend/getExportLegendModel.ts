import {
    getLayersWithLegends,
    type LayerWithLegend,
} from './getLayersWithLegends'
import {
    mmgisGetViewState,
    mmgisGetTimeCurrentFormatted,
    mmgisFormatTime,
    type LegendSwatch,
} from '../adapters/mmgisAPI'

export type ExportLegendRow =
    | {
          kind: 'gradient'
          title: string
          colors: string[] | null
          min: number | null
          max: number | null
          unit: string | null
      }
    | {
          kind: 'categorical'
          title: string
          stops: LegendSwatch[]
      }
    /** A layer with nothing to draw: it is still on the map, so it is still
     *  on the band, as a name. */
    | {
          kind: 'plain'
          title: string
      }

export type ExportLegendModel = {
    missionName: string | null
    /** Lines printed under the mission name, already worded — the renderer
     *  prints them without knowing which is the cursor and which the export. */
    headerLines: string[]
    rows: ExportLegendRow[]
}

/**
 * The band's own lines, under the mission name: where the time cursor sat, and
 * when the picture was made. Both go through core's own formatter so they read
 * the way the mission's Time Control writes a date. A mission without time has
 * no cursor to name. The export time is the one date always available, so an
 * unformattable one prints raw rather than going missing.
 */
const buildHeaderLines = async (): Promise<string[]> => {
    const lines: string[] = []
    try {
        const cursor = await mmgisGetTimeCurrentFormatted()
        if (cursor) lines.push(`Time cursor ${cursor}`)
    } catch (err) {
        console.warn('[export legend] core could not format the time cursor', err)
    }
    const now = new Date().toISOString()
    let exported: string | null = null
    try {
        exported = await mmgisFormatTime(now)
    } catch (err) {
        console.warn('[export legend] could not format the export time', err)
    }
    lines.push(`Exported ${exported ?? now}`)
    return lines
}

/**
 * A layer as one row. Core already resolved what the layer paints with, so
 * this only picks the shape that answer draws as; a layer core had no legend
 * for is still on the map, and still gets its name on the band.
 */
const toRow = (layer: LayerWithLegend): ExportLegendRow => {
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
            unit: layer.unit?.label ?? null,
        }
    }
    return { kind: 'plain', title: layer.title }
}

/**
 * What the legend band draws for the current map: the mission's header lines
 * and a row per toggled-on layer.
 *
 * Nothing narrows that list by where the map is looking. A configured
 * boundingBox is author-written metadata that routinely disagrees with where a
 * layer actually paints, and configured zoom ranges drift the same way, so
 * either test would drop a layer that is plainly on screen. The one exclusion
 * is opacity 0: that signal is local, exact, and means the layer provably
 * paints nothing.
 */
export const getExportLegendModel = async (): Promise<ExportLegendModel> => {
    const [viewState, layers, headerLines] = await Promise.all([
        mmgisGetViewState(),
        getLayersWithLegends({ showOnlyVisible: true }),
        buildHeaderLines(),
    ])
    return {
        missionName: viewState?.missionName ?? null,
        headerLines,
        rows: layers.filter((layer) => layer.opacity !== 0).map(toRow),
    }
}
