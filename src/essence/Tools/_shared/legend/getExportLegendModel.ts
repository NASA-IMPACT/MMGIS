import { getVisibleLayersWithLegends } from './getVisibleLayersWithLegends'
import { resolveColormapColors } from './resolveColormapColors'
import { filterLayersForExportView } from './filterLayersForExportView'
import { layerPeriodFor } from './layerPeriod'
import {
    coverageOverlap,
    hasDataIn,
    clipPeriodToCoverage,
    type Coverage,
    type RequestSpan,
} from './coverageOverlap'
import { formatAtPrecision, formatPeriodEnd } from './datePrecision'
import {
    parseISODuration,
    type Duration,
} from '../../../Basics/TimeControl_/layerTimePolicy'
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

/**
 * A dated span, worded. Both ends of a span print at the same precision, so
 * a span narrower than that precision reads the same at both ends; it says
 * the label once, because `X → X` would only look like a mistake.
 */
const spanLine = (verb: string, start: string, end: string): string =>
    start === end ? `${verb} ${start}` : `${verb} ${start} → ${end}`

/**
 * The span the map asked the server for, which runs from the window start to
 * the cursor and never to the window's right edge. All the app can say about
 * a layer that never told it where its data exists.
 */
const requestedDateLine = (
    { start, end }: RequestSpan,
    precision: Duration | null,
): string | null => {
    const cursorText = formatAtPrecision(precision, end)
    if (!cursorText) return null
    const startText = start ? formatAtPrecision(precision, start) : null
    return startText
        ? `Requested ${startText} → ${cursorText}`
        : `Requested up to ${cursorText}`
}

/**
 * The part of a layer's coverage the request could have returned — the only
 * range the pixels on screen can be from — narrowed to a single period, itself
 * clipped to the coverage, when the layer serves whole periods and the
 * cursor's period holds data. Null
 * when the request and the coverage never meet: the server had nothing inside
 * the span to draw, so the caller falls back to naming the request alone.
 */
const collectedDateLine = (
    interval: string | null,
    request: RequestSpan,
    coverage: Coverage,
    precision: Duration | null,
): string | null => {
    const overlap = coverageOverlap(request, coverage)
    if (!overlap) return null
    const period = layerPeriodFor(interval, request.end, coverage.start)
    if (period && hasDataIn(coverage, period)) {
        const clipped = clipPeriodToCoverage(period, coverage)
        const start = formatAtPrecision(precision, clipped.start)
        // A period ends where the next one starts, so what prints is the last
        // unit it covers; a coverage end inside the period is an instant the
        // data reaches, and prints as it is.
        const end = clipped.endIsPeriodEnd
            ? formatPeriodEnd(precision, clipped.end)
            : formatAtPrecision(precision, clipped.end)
        if (start && end) return spanLine('Collected', start, end)
    }
    // An overlap's ends are instants the layer's data reaches, so they print
    // as they are.
    const end = formatAtPrecision(precision, overlap.end)
    if (!end) return null
    const start = overlap.start
        ? formatAtPrecision(precision, overlap.start)
        : null
    return start ? spanLine('Collected', start, end) : `Collected until ${end}`
}

/**
 * The date line for a layer that follows the slider. Its coverage says where
 * the layer's data exists at all and the request says what the map asked for;
 * with both, the row can name where the pixels came from, and with only the
 * request it can name only the request.
 */
const slidingDateLine = (
    interval: string | null,
    { cursor, windowStart }: TimeCursor,
    extent: TemporalExtent | undefined,
    precision: Duration | null,
): string | null => {
    // A window with no cursor in it has no truthful wording: nothing says
    // where in the window the map was asked to stop.
    if (!cursor) return null
    const request: RequestSpan = {
        start: isOpenEndedStart(windowStart) ? null : windowStart,
        end: cursor,
    }
    const coverage: Coverage = {
        start: extent?.start ?? null,
        end: extent?.end ?? null,
    }
    if (coverage.start !== null || coverage.end !== null) {
        const collected = collectedDateLine(
            interval,
            request,
            coverage,
            precision,
        )
        if (collected) return collected
    }
    return requestedDateLine(request, precision)
}

/**
 * The date line for a layer that ignores the slider: when its data was
 * collected, as far as the mission authored it. A half-open extent stays
 * half-open rather than being closed with a date nobody supplied.
 */
const extentDateLine = (
    extent: TemporalExtent | undefined,
    precision: Duration | null,
): string | null => {
    if (!extent) return null
    const start = extent.start
        ? formatAtPrecision(precision, extent.start)
        : null
    const end = extent.end ? formatAtPrecision(precision, extent.end) : null
    if (start && end) return spanLine('Collected', start, end)
    if (start) return `Collected from ${start}`
    if (end) return `Collected until ${end}`
    return null
}

/**
 * Every date line opens with `Collected` or `Requested`, so a bare `A → B`
 * can never be read as a claim about when the pixels were collected. How precisely its
 * dates print is the layer's own `time.interval`'s business, whichever line
 * it ends up on. Null when no date can be had, which is always safer than a
 * borrowed one.
 */
const dateLineFor = (
    cfg: LayerConfig | undefined,
    extent: TemporalExtent | undefined,
    globalCursor: TimeCursor,
): string | null => {
    const time = cfg?.time
    try {
        const interval =
            typeof time?.interval === 'string' ? time.interval : null
        const precision = interval ? parseISODuration(interval.trim()) : null
        if (time?.enabled !== true) {
            return extentDateLine(extent, precision)
        }
        // A 'local' layer keeps its own window and is not restamped when the
        // slider moves; everything else follows the global cursor.
        const cursor: TimeCursor =
            time.type === 'local'
                ? { cursor: time.end ?? null, windowStart: time.start ?? null }
                : globalCursor
        return slidingDateLine(interval, cursor, extent, precision)
    } catch (err) {
        console.warn('[export legend] could not build a layer date line', err)
        return null
    }
}

/**
 * The band's own lines, under the mission name: where the slider sat, and
 * when the picture was made. Both are instants rather than periods, so they
 * go through core's own formatter and read the way the mission's Time
 * Control writes a date. The export time is the one date always available,
 * so an unformattable one prints raw rather than going missing.
 */
const buildHeaderLines = async (): Promise<string[]> => {
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
        exported = await mmgisFormatTime(now)
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
    const [headerLines, rows] = await Promise.all([
        buildHeaderLines(),
        Promise.all(
            legendLayers.map((layer) =>
                toRow(
                    layer,
                    dateLineFor(
                        layerConfigs?.[layer.id],
                        extents?.[layer.id],
                        globalCursor,
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
