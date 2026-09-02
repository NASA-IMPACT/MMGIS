import { getVisibleLayersWithLegends } from './getVisibleLayersWithLegends'
import { resolveColormapColors } from './resolveColormapColors'
import { filterLayersForExportView } from './filterLayersForExportView'
import { layerPeriodFor } from './layerPeriod'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetCurrentTime,
    mmgisGetCurrentTimeFormatted,
    mmgisGetTemporalExtents,
    mmgisFormatTime,
    type LayerConfig,
    type TemporalExtent,
} from '../adapters/mmgisAPI'
import type { Layer, CategoricalStop } from './types'

export type ExportLegendRow =
    | {
          kind: 'gradient'
          title: string
          dateLine: string | null
          colors: string[] | null
          min: number | string | null
          max: number | string | null
          unit: string | null
      }
    | {
          kind: 'categorical'
          title: string
          dateLine: string | null
          stops: CategoricalStop[]
      }
    /** A layer with nothing to draw: it is still on the map, so it is still
     *  on the band, as a name and its date line. */
    | {
          kind: 'plain'
          title: string
          dateLine: string | null
      }

export type ExportLegendModel = {
    missionName: string | null
    /** Lines printed under the mission name, already worded — the renderer
     *  prints them without knowing which is the cursor and which the export. */
    headerLines: string[]
    rows: ExportLegendRow[]
}

type FormatTime = (time: string) => Promise<string | null>

/** The cursor a layer's tiles were requested at, and the window start that
 *  request ran from. */
type TimeCursor = { cursor: string | null; windowStart: string | null }

const globalTimeCursor = async (): Promise<TimeCursor> => {
    try {
        const [cursor, windowStart] = await Promise.all([
            mmgisGetCurrentTime(),
            mmgisGetTimeStart(),
        ])
        return { cursor, windowStart }
    } catch (err) {
        console.warn('[export legend] core reported no time cursor', err)
        return { cursor: null, windowStart: null }
    }
}

const temporalExtents = async (): Promise<Record<
    string,
    TemporalExtent
> | null> => {
    try {
        return await mmgisGetTemporalExtents()
    } catch (err) {
        console.warn('[export legend] core reported no layer extents', err)
        return null
    }
}

/**
 * Formats through core (`time:formatTime`) so a date on the band reads the
 * same way as the mission's own time UI, and so the d3-vs-moment rule behind
 * that lives in exactly one place. Repeated timestamps — the cursor and
 * window shared by every layer that follows it — are requested once.
 */
const missionTimeFormatter = (): FormatTime => {
    const pending = new Map<string, Promise<string | null>>()
    return (time: string) => {
        const cached = pending.get(time)
        if (cached) return cached
        const request = mmgisFormatTime(time)
        pending.set(time, request)
        return request
    }
}

// Point mode on the slider sets the window start to the epoch, rebuilt from
// local date components — so it arrives shifted by the browser's UTC offset,
// at most ±14 hours either side of 1970-01-01. Nothing on the bus says which
// mode is active, so only a start within a day of the epoch is read as "no
// start was asked for"; a genuine window start decades ago must survive and
// be printed.
const isOpenEndedStart = (windowStart: string | null): boolean => {
    if (!windowStart) return true
    const ms = Date.parse(windowStart)
    return Number.isNaN(ms) ? false : Math.abs(ms) < 86_400_000
}

// A period's `end` is the boundary the next period starts on, so printing it
// would make a P7D period read as eight days.
const lastInstantOf = (end: string): string =>
    new Date(Date.parse(end) - 1000).toISOString()

/**
 * The date line for a layer that follows the slider. A layer serving whole
 * periods gets the period holding the cursor; everything else gets the span
 * the map actually requested, which runs from the window start to the cursor
 * and never to the window's right edge.
 */
const slidingDateLine = async (
    interval: string | null,
    { cursor, windowStart }: TimeCursor,
    anchor: string | null,
    formatTime: FormatTime,
): Promise<string | null> => {
    const period = layerPeriodFor(interval, cursor, anchor)
    if (period?.kind === 'calendar') return `Showing ${period.label}`
    if (period?.kind === 'range') {
        const [start, end] = await Promise.all([
            formatTime(period.start),
            formatTime(lastInstantOf(period.end)),
        ])
        if (start && end) return `Showing ${start} → ${end}`
    }
    // A window with no cursor in it has no truthful wording: nothing says
    // where in the window the map was asked to stop.
    if (!cursor) return null
    const cursorText = await formatTime(cursor)
    if (!cursorText) return null
    const startText = isOpenEndedStart(windowStart)
        ? null
        : await formatTime(windowStart)
    return startText
        ? `Requested ${startText} → ${cursorText}`
        : `Requested up to ${cursorText}`
}

/**
 * The date line for a layer that ignores the slider: when its data was
 * collected, as far as the mission authored it. A half-open extent stays
 * half-open rather than being closed with a date nobody supplied.
 */
const collectedDateLine = async (
    extent: TemporalExtent | undefined,
    formatTime: FormatTime,
): Promise<string | null> => {
    if (!extent) return null
    const [start, end] = await Promise.all([
        extent.start ? formatTime(extent.start) : null,
        extent.end ? formatTime(extent.end) : null,
    ])
    if (start && end) return `Collected ${start} → ${end}`
    if (start) return `Collected from ${start}`
    if (end) return `Collected until ${end}`
    return null
}

/**
 * Every date line names what kind of date it is, so a bare `A → B` can never
 * be read as a claim about when the pixels were collected. Null when no date
 * can be had, which is always safer than a borrowed one.
 */
const dateLineFor = async (
    cfg: LayerConfig | undefined,
    extent: TemporalExtent | undefined,
    globalCursor: TimeCursor,
    formatTime: FormatTime,
): Promise<string | null> => {
    const time = cfg?.time
    try {
        if (time?.enabled !== true) {
            return await collectedDateLine(extent, formatTime)
        }
        // A 'local' layer keeps its own window and is not restamped when the
        // slider moves; everything else follows the global cursor.
        const cursor: TimeCursor =
            time.type === 'local'
                ? { cursor: time.end ?? null, windowStart: time.start ?? null }
                : globalCursor
        return await slidingDateLine(
            typeof time.interval === 'string' ? time.interval : null,
            cursor,
            extent?.start ?? null,
            formatTime,
        )
    } catch (err) {
        console.warn('[export legend] could not build a layer date line', err)
        return null
    }
}

/**
 * The band's own lines, under the mission name: where the slider sat, and
 * when the picture was made. The export time is the one date always
 * available, so an unformattable one prints raw rather than going missing.
 */
const buildHeaderLines = async (formatTime: FormatTime): Promise<string[]> => {
    const lines: string[] = []
    try {
        const cursor = await mmgisGetCurrentTimeFormatted()
        if (cursor) lines.push(`Time cursor ${cursor}`)
    } catch (err) {
        console.warn(
            '[export legend] core could not format the time cursor',
            err,
        )
    }
    const now = new Date().toISOString()
    let exported: string | null = null
    try {
        exported = await formatTime(now)
    } catch (err) {
        console.warn('[export legend] could not format the export time', err)
    }
    lines.push(`Exported ${exported ?? now}`)
    return lines
}

// A manually authored legend (variables.legend / legend CSV) is the layer's
// legend, full stop — even when the layer also carries a live cog colormap.
// The auto-derived colormap/rescale bar only stands in when nothing was
// authored. A layer with neither still gets a row, carrying its name and
// date line alone.
const toRow = async (
    layer: Layer,
    dateLine: string | null,
): Promise<ExportLegendRow> => {
    if (layer.type === 'categorical' && layer.categoricalStops?.length) {
        return {
            kind: 'categorical',
            title: layer.title,
            dateLine,
            stops: layer.categoricalStops,
        }
    }
    if (layer.type === 'gradient' && layer.stops?.length) {
        return {
            kind: 'gradient',
            title: layer.title,
            dateLine,
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
            dateLine,
            colors: await resolveColormapColors(
                layer.cog.colormap,
                layer.cog.titilerUrl,
            ),
            min: layer.cog.min,
            max: layer.cog.max,
            unit: layer.cog.units ?? null,
        }
    }
    return { kind: 'plain', title: layer.title, dateLine }
}

export const getExportLegendModel = async (): Promise<ExportLegendModel> => {
    // layerConfigs is fetched once here and threaded into
    // getVisibleLayersWithLegends below, rather than each independently
    // requesting layers:getAllConfigs from core. The extents come in one
    // no-arg sweep for the same reason.
    const [layerConfigs, viewState, globalCursor, extents] = await Promise.all([
        mmgisGetLayerConfigs(),
        mmgisGetViewState(),
        globalTimeCursor(),
        temporalExtents(),
    ])
    const layers = await getVisibleLayersWithLegends({
        showOnlyVisible: true,
        layerConfigs,
    })
    // Drops the layers that paint nothing (opacity 0); panel/LayerManager
    // listings stay unfiltered, so this is export-only.
    const legendLayers = filterLayersForExportView(layers)
    const formatTime = missionTimeFormatter()
    const [headerLines, rows] = await Promise.all([
        buildHeaderLines(formatTime),
        Promise.all(
            legendLayers.map(async (layer) =>
                toRow(
                    layer,
                    await dateLineFor(
                        layerConfigs?.[layer.id],
                        extents?.[layer.id],
                        globalCursor,
                        formatTime,
                    ),
                ),
            ),
        ),
    ])
    return {
        missionName: viewState?.missionName ?? null,
        headerLines,
        rows,
    }
}
