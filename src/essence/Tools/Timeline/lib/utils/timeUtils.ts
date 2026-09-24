import moment from 'moment'
import type { TimeMode, TimeRange } from '../types'

/**
 * Calculate the appropriate time step based on the time mode
 */
export function getTimeStep(mode: TimeMode): {
    unit: moment.unitOfTime.DurationConstructor
    value: number
} {
    switch (mode) {
        case 'YEAR':
            return { unit: 'years', value: 1 }
        case 'MONTH':
            return { unit: 'months', value: 1 }
        case 'DAY':
            return { unit: 'days', value: 1 }
        case 'HOUR':
            return { unit: 'hours', value: 1 }
    }
}

const MS_HOUR = 3600 * 1000
const MS_DAY = 24 * MS_HOUR

/**
 * The unit an axis spanning `startTime`–`endTime` is labelled in: the finest
 * one whose ticks still fit `maxTicks`, once generateTimeTicks has thinned
 * them to its readable multiples. Each unit gives way to the next where
 * thinning would stop reading as that unit: past 12-hour steps, hours read
 * better as days; past fortnightly steps, days read better as months; past
 * quarterly steps, months read better as years.
 */
export function tickModeForSpan(
    startTime: Date,
    endTime: Date,
    maxTicks: number
): TimeMode {
    const span = endTime.getTime() - startTime.getTime()
    if (span / MS_HOUR <= maxTicks * 12) return 'HOUR'
    if (span / MS_DAY <= maxTicks * 14) return 'DAY'
    if (span / (30.44 * MS_DAY) <= maxTicks * 3) return 'MONTH'
    return 'YEAR'
}

/** A unit that names the period a tick falls in. */
export type ContextMode = Exclude<TimeMode, 'HOUR'>

/** The unit one coarser than each tick unit, which names the period it falls in. */
const CONTEXT_MODE: Record<TimeMode, ContextMode | null> = {
    HOUR: 'DAY',
    DAY: 'MONTH',
    MONTH: 'YEAR',
    // A year label is already a whole date at that scale.
    YEAR: null,
}

/**
 * The labels that place ticks of `tickMode` in time, one unit coarser: an
 * hourly axis is headed by its days, a daily one by its months. Each period
 * that begins inside the view is labelled at its boundary, and the view's own
 * start is labelled too, so a view inside a single period still names it.
 * That leading label is left out when the first boundary falls within
 * `minGapMs` of it, where the two would overlap.
 */
export function contextTicks(
    startTime: Date,
    endTime: Date,
    tickMode: TimeMode,
    minGapMs: number
): { mode: ContextMode | null; ticks: Date[] } {
    const mode = CONTEXT_MODE[tickMode]
    if (mode === null) return { mode, ticks: [] }

    const { unit } = getTimeStep(mode)
    const boundaries: Date[] = []
    let current = moment
        .utc(startTime)
        .startOf(unit as moment.unitOfTime.StartOf)
        .add(1, unit)
    while (!current.isAfter(endTime)) {
        boundaries.push(current.toDate())
        current = current.clone().add(1, unit)
    }

    const first = boundaries[0]
    const leadingFits =
        !first || first.getTime() - startTime.getTime() >= minGapMs
    return { mode, ticks: leadingFits ? [startTime, ...boundaries] : boundaries }
}

/** A period named in full, UTC, for the axis above the ticks. */
export function formatContext(date: Date, mode: ContextMode): string {
    const m = moment.utc(date)
    switch (mode) {
        case 'YEAR':
            return m.format('YYYY')
        case 'MONTH':
            return m.format('MMM YYYY')
        case 'DAY':
            return m.format('MMM D, YYYY')
    }
}

/**
 * Generate time ticks for the timeline axis
 */
export function generateTimeTicks(
    startTime: Date,
    endTime: Date,
    mode: TimeMode,
    maxTicks: number = 100
): Date[] {
    const ticks: Date[] = []
    const { unit, value } = getTimeStep(mode)

    // The whole plugin reads and writes UTC, so ticks snap to UTC unit
    // boundaries. Local snapping would offset every label from the date it
    // carries by the viewer's UTC offset.
    const start = moment.utc(startTime)
    const end = moment.utc(endTime)
    if (!end.isAfter(start)) return [startTime]

    // Snapping to the unit boundary can land before the domain; step forward
    // until the first tick is inside it so the axis never renders a label for
    // an instant left of startTime.
    let current = start.clone().startOf(unit as moment.unitOfTime.StartOf)

    const totalSteps = end.diff(current, unit as moment.unitOfTime.Diff) / value
    let stepMultiplier = 1
    if (totalSteps > maxTicks) {
        stepMultiplier = Math.ceil(totalSteps / maxTicks)

        // Round the multiplier to a readable interval
        if (unit === 'hours') {
            if (stepMultiplier <= 2) stepMultiplier = 2
            else if (stepMultiplier <= 3) stepMultiplier = 3
            else if (stepMultiplier <= 6) stepMultiplier = 6
            else if (stepMultiplier <= 12) stepMultiplier = 12
            else stepMultiplier = Math.ceil(stepMultiplier / 24) * 24
        } else if (unit === 'days') {
            if (stepMultiplier <= 2) stepMultiplier = 2
            else if (stepMultiplier <= 7) stepMultiplier = 7
            else if (stepMultiplier <= 14) stepMultiplier = 14
            else stepMultiplier = Math.ceil(stepMultiplier / 30) * 30
        }
    }

    const step = value * stepMultiplier
    while (current.isBefore(start)) {
        current = current.add(step, unit)
    }

    let count = 0
    while (current.isBefore(end) && count < maxTicks) {
        ticks.push(current.toDate())
        current = current.clone().add(step, unit)
        count++
    }

    // Only unit boundaries are marked. The view's end is left unlabelled: it
    // falls between boundaries, so a label there would crowd the last one.
    return ticks
}

/**
 * Format date based on time mode. UTC, matching the header, the layer bar
 * tooltips and the scrubber's accessible value.
 */
export function formatDateByMode(date: Date, mode: TimeMode): string {
    const m = moment.utc(date)
    switch (mode) {
        case 'YEAR':
            return m.format('YYYY')
        case 'MONTH':
            return m.format('MMM YYYY')
        case 'DAY':
            return m.format('MMM D')
        case 'HOUR':
            return m.format('HH:mm')
    }
}

/**
 * Move an instant by whole time-mode units, in UTC. Local calendar arithmetic
 * would make a step across the viewer's daylight-saving boundary 23 or 25
 * hours long, drifting the displayed UTC clock by an hour each time.
 */
export function stepTime(date: Date, mode: TimeMode, steps: number): Date {
    const { unit, value } = getTimeStep(mode)
    return moment
        .utc(date)
        .add(steps * value, unit)
        .toDate()
}

/**
 * The month of `year` nearest to `month` that [startTime, endTime] covers.
 * Stepping or typing a year can leave the held month outside the timeline —
 * January of the end year, say, when the range only reaches back to June — so
 * the pickers snap to the nearest covered month instead of refusing the year.
 */
export function snapMonthToRange(
    year: number,
    month: number,
    startTime: Date,
    endTime: Date
): number {
    const start = moment.utc(startTime)
    const end = moment.utc(endTime)
    const first = year === start.year() ? start.month() : 0
    const last = year === end.year() ? end.month() : 11
    return Math.min(last, Math.max(first, month))
}

/**
 * Clamp a date to be within a range
 */
export function clampDate(date: Date, min: Date, max: Date): Date {
    if (date < min) return min
    if (date > max) return max
    return date
}

/**
 * The time block of a layer's configuration, as far as the timeline reads it.
 */
export interface LayerTimeConfig {
    enabled?: boolean
    dataStartTime?: string
    dataEndTime?: string
    dataDates?: string[] | string
    /** The ISO 8601 duration a periodic layer's data repeats at, e.g. `P1D`. */
    interval?: string
}

/** A layer's extent, with either bound completed from the caller's fallback. */
export interface ResolvedLayerExtent {
    start: Date
    end: Date
    /** False when `start` is the fallback, `dataStartTime` naming no readable bound. */
    hasOwnStart: boolean
    /** False when `end` is the fallback, `dataEndTime` naming no readable bound. */
    hasOwnEnd: boolean
}

/**
 * A layer's `dataStartTime`/`dataEndTime` extent. `dataEndTime` of `'now'`
 * resolves to the current instant, and a bound that is absent or fails to
 * parse falls back to the one supplied. Parsing is lenient, since configs
 * carry these in looser formats than ISO 8601.
 */
export function resolveLayerExtent(
    time: LayerTimeConfig | undefined,
    fallbackStart: Date,
    fallbackEnd: Date
): ResolvedLayerExtent {
    const parsedStart = time?.dataStartTime ? new Date(time.dataStartTime) : null
    const parsedEnd =
        time?.dataEndTime === 'now'
            ? new Date()
            : time?.dataEndTime
            ? new Date(time.dataEndTime)
            : null

    const start =
        parsedStart && !isNaN(parsedStart.getTime()) ? parsedStart : null
    const end = parsedEnd && !isNaN(parsedEnd.getTime()) ? parsedEnd : null

    return {
        start: start ?? fallbackStart,
        end: end ?? fallbackEnd,
        hasOwnStart: start !== null,
        hasOwnEnd: end !== null,
    }
}

/** The period a listed entry covers. The hour is the finest. */
export type ListedUnit = 'year' | 'month' | 'day' | 'hour'

/**
 * One entry a layer lists data at. `unit` is what the entry names — 2020 a
 * year, 2020-03 a month, 2020-03-04 a day, 2020-03-04T14 an hour, and
 * anything finer still its hour — and `start`/`end` cover the whole of it.
 * `at` is the entry's own timestamp with any part left out filled with its
 * start, so 2020-03 is 1 March 00:00 and 14:30:15 stays 14:30:15 though its
 * span is 14:00–14:59.
 */
export interface ListedEntry {
    at: Date
    start: Date
    end: Date
    unit: ListedUnit
}

/** The unit an ISO 8601 entry names, read from the format it matched. */
function unitOf(format: string): ListedUnit {
    if (format.includes('HH')) return 'hour'
    if (format.includes('D') || format.includes('E')) return 'day'
    if (format.includes('MM')) return 'month'
    return 'year'
}

/**
 * The entries a layer lists data at, each read strictly as ISO 8601 in UTC,
 * give or take the surrounding whitespace a comma-separated list picks up.
 * `dataDates` is accepted as a list or as a single bare string. Anything
 * else is dropped rather than guessed at, so a mistyped entry costs the layer
 * that entry rather than its whole row.
 *
 * Read in UTC, matching every other instant the plugin handles; reading
 * locally would shift each entry off the period it names by the viewer's
 * offset.
 *
 * An entry listed twice is kept once. Ordered by where each starts, then by
 * its timestamp. The one parse of `dataDates`: the spans a row draws and the
 * instants it navigates through both come from here, so neither can drift
 * from the other.
 */
export function resolveListedEntries(
    time: LayerTimeConfig | undefined
): ListedEntry[] {
    const raw = time?.dataDates
    const listed = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
        ? [raw]
        : []

    const byKey = new Map<string, ListedEntry>()
    listed.forEach((date) => {
        const entry = moment.utc(String(date).trim(), moment.ISO_8601, true)
        if (!entry.isValid()) return
        const unit = unitOf(String(entry.creationData().format ?? ''))
        const at = entry.valueOf()
        byKey.set(`${unit}|${at}`, {
            at: new Date(at),
            start: entry.clone().startOf(unit).toDate(),
            end: entry.clone().endOf(unit).toDate(),
            unit,
        })
    })

    return [...byKey.values()].sort(
        (a, b) =>
            a.start.getTime() - b.start.getTime() ||
            a.at.getTime() - b.at.getTime() ||
            a.end.getTime() - b.end.getTime()
    )
}

const LABEL_FORMAT: Record<ListedUnit, string> = {
    year: 'YYYY',
    month: 'YYYY-MM',
    day: 'YYYY-MM-DD',
    hour: 'YYYY-MM-DD HH:00',
}

/**
 * The spans of the timeline a layer holds data for.
 *
 * A layer that carries data continuously is one span, running the length of
 * its configured extent. A sparse layer — data at a scattered handful of
 * times rather than throughout — lists those times instead, and gets one span
 * per period an entry names: a whole year, month, day or hour, so the
 * timeline shows the gaps rather than implying coverage the layer does not
 * have. Entries sharing one period are drawn as one span. Listing nothing
 * readable keeps the single continuous span, whose extent is read leniently,
 * since configs carry those bounds in looser formats than the entries.
 */
export function resolveLayerTimeRanges(
    time: LayerTimeConfig | undefined,
    fallbackStart: Date,
    fallbackEnd: Date
): TimeRange[] {
    if (!time || time.enabled !== true)
        return [{ start: fallbackStart, end: fallbackEnd }]

    const entries = resolveListedEntries(time)

    if (entries.length > 0) {
        // Two spans over one period would stack, and the pair would read
        // darker than its neighbours through the bars' shared opacity.
        const bySpan = new Map<string, TimeRange>()
        entries.forEach((entry) => {
            const key = `${entry.start.getTime()}|${entry.end.getTime()}`
            if (bySpan.has(key)) return
            bySpan.set(key, {
                start: entry.start,
                end: entry.end,
                label: moment.utc(entry.start).format(LABEL_FORMAT[entry.unit]),
            })
        })
        return [...bySpan.values()]
    }

    const { start, end } = resolveLayerExtent(time, fallbackStart, fallbackEnd)
    return [{ start, end }]
}
