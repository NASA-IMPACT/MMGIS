import {
    getLayersWithLegends,
    type LayerWithLegend,
} from './getLayersWithLegends'
import { layerPeriodFor } from './layerPeriod'
import {
    coverageOverlap,
    hasDataIn,
    type Coverage,
    type RequestSpan,
} from './coverageOverlap'
import { formatAtPrecision, formatPeriodEnd } from './datePrecision'
import { parseInstant } from './isoInstant'
import {
    parseISODuration,
    type Duration,
} from '../../../Basics/TimeControl_/layerTimePolicy'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeCurrent,
    mmgisGetTimeCurrentFormatted,
    mmgisGetTemporalExtents,
    mmgisGetDataCoverage,
    mmgisFormatTime,
    type LayerConfig,
    type LayerDataCoverage,
    type LegendSwatch,
    type TemporalExtent,
} from '../adapters/mmgisAPI'

export type ExportLegendRow =
    | {
          kind: 'gradient'
          title: string
          dateLine: string | null
          colors: string[] | null
          min: number | null
          max: number | null
          unit: string | null
      }
    | {
          kind: 'categorical'
          title: string
          dateLine: string | null
          stops: LegendSwatch[]
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
            mmgisGetTimeCurrent(),
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

const dataCoverage = async (): Promise<Record<
    string,
    LayerDataCoverage
> | null> => {
    try {
        return await mmgisGetDataCoverage()
    } catch (err) {
        console.warn('[export legend] core reported no data coverage', err)
        return null
    }
}

/**
 * The date line for a time-enabled layer core found no data for at the
 * cursor. Core hides such a layer and skips its request, so it paints
 * nothing, and any `Collected` range would name pixels that are not there.
 */
const NO_DATA_AT_CURSOR = 'No data at cursor'

// Point mode on the Time Control sets the window start to the epoch, rebuilt
// from local date components — so it arrives shifted by the browser's UTC
// offset, at most ±14 hours either side of 1970-01-01. Nothing on the bus says
// which mode is active, so only a start within a day of the epoch is read as
// "no start was asked for"; a genuine window start decades ago must survive
// and be printed.
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
        ? spanLine('Requested', startText, cursorText)
        : `Requested up to ${cursorText}`
}

/**
 * The part of a layer's coverage the request could have returned — the only
 * range the pixels on screen can be from — narrowed to a single period, itself
 * clipped to the coverage, when the layer serves whole periods and the
 * cursor's period holds data. Null when the request and the coverage never
 * meet: the server had nothing inside the span to draw, so the caller falls
 * back to naming the request alone. Only reached for a layer core says has
 * data at the cursor, or one core gave no verdict for.
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
        const start = formatAtPrecision(precision, period.start)
        // A period ends where the next one starts, so what prints is the last
        // unit it covers. The period is printed whole: core floors a periodic
        // layer's extent end to the last step's start, so a coverage end
        // inside this period says the period is the last one the layer holds,
        // not that its data stops partway through.
        const end = formatPeriodEnd(precision, period.end)
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
 * The date line for a layer that follows the time cursor. Its coverage says
 * where the layer's data exists at all and the request says what the map asked
 * for; with both, the row can name where the pixels came from, and with only
 * the request it can name only the request.
 */
const cursorDateLine = (
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
    // A bound that will not parse is no coverage at all. The overlap reads an
    // unreadable bound as unbounded, which is right for narrowing a range and
    // wrong for deciding there is one: without this, an extent of two bad
    // strings would print the request itself as `Collected`.
    const coverage: Coverage = {
        start: parseInstant(extent?.start)?.text ?? null,
        end: parseInstant(extent?.end)?.text ?? null,
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
 * The date line for a layer that ignores the time cursor: when its data was
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
 * Every dated line opens with `Collected` or `Requested`, so a bare `A → B`
 * can never be read as a claim about when the pixels were collected. How
 * precisely its dates print is the layer's own `time.interval`'s business,
 * whichever line it ends up on. Null when no date can be had, which is always
 * safer than a borrowed one.
 *
 * Whether a time-enabled layer has data at the cursor is core's call, not
 * this module's: core's coverage gate decides it on every time step and hides
 * the layer when the answer is no. The band follows that verdict before any
 * range is worked out, so it never claims a collection range beside a layer
 * that is painting nothing. With no verdict for the layer, the ranges decide.
 */
const dateLineFor = (
    cfg: LayerConfig | undefined,
    extent: TemporalExtent | undefined,
    coverage: LayerDataCoverage | undefined,
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
        if (coverage?.outOfDataRange === true) return NO_DATA_AT_CURSOR
        // A 'local' layer keeps its own window and is not restamped when the
        // time cursor moves; everything else follows the global cursor. A
        // local layer the dashboard has not stamped yet has no window of its
        // own to read, and the global one is what its features are filtered
        // against until it does.
        const local: TimeCursor = {
            cursor: time.end ?? null,
            windowStart: time.start ?? null,
        }
        const cursor: TimeCursor =
            time.type === 'local' && local.cursor ? local : globalCursor
        return cursorDateLine(interval, cursor, extent, precision)
    } catch (err) {
        console.warn('[export legend] could not build a layer date line', err)
        return null
    }
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
const toRow = (
    layer: LayerWithLegend,
    dateLine: string | null,
): ExportLegendRow => {
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
            unit: layer.unit?.label ?? null,
        }
    }
    return { kind: 'plain', title: layer.title, dateLine }
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
    // The configs are asked for once and handed to the row assembly, which
    // would otherwise request them again for itself.
    const layerConfigs = await mmgisGetLayerConfigs()
    const [viewState, layers, headerLines, globalCursor, extents, coverages] =
        await Promise.all([
            mmgisGetViewState(),
            getLayersWithLegends({ showOnlyVisible: true, layerConfigs }),
            buildHeaderLines(),
            globalTimeCursor(),
            temporalExtents(),
            dataCoverage(),
        ])
    return {
        missionName: viewState?.missionName ?? null,
        headerLines,
        rows: layers
            .filter((layer) => layer.opacity !== 0)
            .map((layer) =>
                toRow(
                    layer,
                    dateLineFor(
                        layerConfigs?.[layer.id],
                        extents?.[layer.id],
                        coverages?.[layer.id],
                        globalCursor,
                    ),
                ),
            ),
    }
}
