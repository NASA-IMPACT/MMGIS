import {
    getLayersWithLegends,
    type LayerWithLegend,
} from './getLayersWithLegends'
import {
    coverageOverlap,
    type Coverage,
    type RequestSpan,
} from './coverageOverlap'
import { formatAtPrecision, formatEpochMsAtUnit } from './datePrecision'
import { parseInstant } from './isoInstant'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeCurrent,
    mmgisGetTimeMode,
    mmgisGetTimeCurrentFormatted,
    mmgisGetTemporalExtents,
    mmgisGetDataCoverage,
    mmgisFormatTime,
    type CoverageSpan,
    type Duration,
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

/** A labelled date printed under the mission name. The renderer prints the
 *  label and value without knowing which is the cursor and which the export. */
export type ExportHeaderFact = { label: string; value: string }

export type ExportLegendModel = {
    missionName: string | null
    headerFacts: ExportHeaderFact[]
    rows: ExportLegendRow[]
}

type TimeMode = 'range' | 'point' | null

/** The Time Control's window start, its cursor, and the mode both were set
 *  in: what a layer's request falls back to when neither core's record nor
 *  the layer's own config says what it requested. A null mode (the Time UI
 *  bar is not mounted) leaves the window start to speak for itself. */
type TimeCursor = {
    cursor: string | null
    windowStart: string | null
    mode: TimeMode
}

/** The span a layer's tiles were requested for, and whether core requested
 *  one whole period for it rather than the Time Control window. */
type LayerRequest = {
    start: string | null
    end: string | null
    periodic: boolean
}

const timeMode = async (): Promise<TimeMode> => {
    try {
        return await mmgisGetTimeMode()
    } catch (err) {
        console.warn('[export legend] core reported no time mode', err)
        return null
    }
}

const globalTimeCursor = async (): Promise<TimeCursor> => {
    const modeRequest = timeMode()
    try {
        const [cursor, windowStart] = await Promise.all([
            mmgisGetTimeCurrent(),
            mmgisGetTimeStart(),
        ])
        return { cursor, windowStart, mode: await modeRequest }
    } catch (err) {
        console.warn('[export legend] core reported no time cursor', err)
        return { cursor: null, windowStart: null, mode: await modeRequest }
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

/**
 * A dated span, worded. Both ends of a span print at the same precision, so
 * a span narrower than that precision reads the same at both ends; it says
 * the label once, because `X → X` would only look like a mistake.
 */
const spanLine = (verb: string, start: string, end: string): string =>
    start === end ? `${verb} ${start}` : `${verb} ${start} → ${end}`

/**
 * The span the map asked the server for. All the app can say about a layer
 * that never told it where its data exists, or whose data the request missed.
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
 * Where the pixels on screen can be from, or null when the request and the
 * coverage never meet: the server had nothing inside the span to draw, so the
 * caller falls back to naming the request alone. Only reached for a layer
 * core says has data at the cursor, or one core gave no verdict for.
 *
 * A periodic request is one whole period, and the server answers it with that
 * period's scene, so the period prints whole — its end is already the last
 * inclusive second, so it prints as it is. It is not clipped to the coverage:
 * core floors a periodic extent's end to the last step's start, so clipping
 * would cut the last period down to an instant. Any other request prints the
 * part of the coverage it could have returned.
 */
const collectedDateLine = (
    request: RequestSpan,
    periodic: boolean,
    coverage: Coverage,
    precision: Duration | null,
): string | null => {
    const overlap = coverageOverlap(request, coverage)
    if (!overlap) return null
    const span = periodic ? request : overlap
    const end = formatAtPrecision(precision, span.end)
    if (!end) return null
    const start = span.start ? formatAtPrecision(precision, span.start) : null
    return start ? spanLine('Collected', start, end) : `Collected until ${end}`
}

/**
 * The date line for a layer that follows the time cursor. Its coverage says
 * where the layer's data exists at all and the request says what the map asked
 * for; with both, the row can name where the pixels came from, and with only
 * the request it can name only the request.
 */
const cursorDateLine = (
    { start, end, periodic }: LayerRequest,
    extent: TemporalExtent | undefined,
    precision: Duration | null,
): string | null => {
    // A request with no end has no truthful wording: nothing says where in
    // the window the map was asked to stop.
    if (!end) return null
    const request: RequestSpan = { start, end }
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
            request,
            periodic,
            coverage,
            precision,
        )
        if (collected) return collected
    }
    return requestedDateLine(request, precision)
}

/**
 * The date line for a layer that lists Data Dates: the listed entry the
 * cursor sits in, at that entry's own precision, or null when no entry holds
 * the cursor. The narrowest entry wins when entries nest, since it is the most
 * exact statement of what was collected.
 *
 * The entry is printed rather than the request because it is what is on
 * screen: a layer that lists its dates has tile URLs that ask for exactly the
 * cursor's entry, whatever the chart window or `time.interval` say. An entry
 * names one unit, so it prints as one label, never a range.
 */
const sparseDateLine = (
    record: LayerDataCoverage,
    cursorMs: number,
): string | null => {
    let narrowest: CoverageSpan | null = null
    for (const span of record.spans ?? []) {
        if (!span.unit) continue
        if (span.start > cursorMs || cursorMs > span.end) continue
        const width = span.end - span.start
        if (!narrowest || width < narrowest.end - narrowest.start) {
            narrowest = span
        }
    }
    if (!narrowest?.unit) return null
    const entry = formatEpochMsAtUnit(narrowest.unit, narrowest.start)
    return entry ? `Collected ${entry}` : null
}

const msToIso = (ms: number): string | null => {
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The span a time-enabled layer was requested for. Core's record of the
 * window it stamped on the layer comes first; without one, the window the
 * layer's own config carries; without that, the Time Control's window start
 * and cursor.
 *
 * Point mode pins the Time Control's window start to the epoch, so a layer
 * requesting the window had no real start, and its start is dropped. A
 * periodic layer's start is the start of its period, a real bound, and is
 * kept.
 */
const layerRequest = (
    time: NonNullable<LayerConfig['time']>,
    record: LayerDataCoverage | undefined,
    globalCursor: TimeCursor,
): LayerRequest => {
    const periodic = record?.periodic === true
    let start: string | null
    let end: string | null
    if (record?.requestedWindow) {
        start = msToIso(record.requestedWindow.start)
        end = msToIso(record.requestedWindow.end)
    } else if (typeof time.end === 'string' && time.end) {
        start = typeof time.start === 'string' ? time.start : null
        end = time.end
    } else {
        start = globalCursor.windowStart
        end = globalCursor.cursor
    }
    if (!periodic && globalCursor.mode === 'point') start = null
    return { start, end, periodic }
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
 * read as core parsed it, whichever line it ends up on. Null when no date can
 * be had, which is always safer than a borrowed one.
 *
 * Whether a time-enabled layer has data at the cursor is core's call, not
 * this module's: core's coverage gate decides it on every time step and hides
 * the layer when the answer is no. The band follows that verdict before any
 * range is worked out, so it never claims a collection range beside a layer
 * that is painting nothing. With no verdict for the layer, the ranges decide.
 * A layer that lists Data Dates prints the entry the cursor sits in and
 * nothing about the request or the window; only when no entry holds the
 * cursor, which a stale record can cause, do the ranges decide for it too.
 */
const dateLineFor = (
    cfg: LayerConfig | undefined,
    extent: TemporalExtent | undefined,
    record: LayerDataCoverage | undefined,
    globalCursor: TimeCursor,
): string | null => {
    const time = cfg?.time
    try {
        const precision = extent?.interval ?? null
        if (!time || time.enabled !== true) {
            return extentDateLine(extent, precision)
        }
        if (record?.outOfDataRange === true) return NO_DATA_AT_CURSOR
        const request = layerRequest(time, record, globalCursor)
        if (record?.kind === 'sparse' && request.end) {
            const cursorMs = parseInstant(request.end)?.ms
            const sparse =
                cursorMs === undefined ? null : sparseDateLine(record, cursorMs)
            if (sparse) return sparse
        }
        return cursorDateLine(request, extent, precision)
    } catch (err) {
        console.warn('[export legend] could not build a layer date line', err)
        return null
    }
}

/**
 * The band's own facts, under the mission name: where the time cursor sat, and
 * when the picture was made. Both go through core's own formatter so they read
 * the way the mission's Time Control writes a date. A mission without time has
 * no cursor to name. The export time is the one date always available, so an
 * unformattable one prints raw rather than going missing.
 */
const buildHeaderFacts = async (): Promise<ExportHeaderFact[]> => {
    const facts: ExportHeaderFact[] = []
    try {
        const cursor = await mmgisGetTimeCurrentFormatted()
        if (cursor) facts.push({ label: 'Time cursor', value: cursor })
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
    facts.push({ label: 'Exported', value: exported ?? now })
    return facts
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
 * What the legend band draws for the current map: the mission's header facts
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
    const [viewState, layers, headerFacts, globalCursor, extents, coverages] =
        await Promise.all([
            mmgisGetViewState(),
            getLayersWithLegends({ showOnlyVisible: true, layerConfigs }),
            buildHeaderFacts(),
            globalTimeCursor(),
            temporalExtents(),
            dataCoverage(),
        ])
    return {
        missionName: viewState?.missionName ?? null,
        headerFacts,
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
