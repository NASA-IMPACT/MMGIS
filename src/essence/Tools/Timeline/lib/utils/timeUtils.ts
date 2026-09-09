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

    // Close the axis on the domain's end, unless a tick already sits there.
    const last = ticks[ticks.length - 1]
    if (!last || last.getTime() !== endTime.getTime()) {
        ticks.push(endTime)
    }

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
}

/**
 * A layer's extent as resolved from its own configuration, with either bound
 * missing or unreadable completed from the supplied fallback.
 */
export interface ResolvedLayerExtent {
    start: Date
    end: Date
    /**
     * Whether `dataStartTime` or `dataEndTime` named a bound that parsed. A
     * layer that names neither has nothing of its own in `start`/`end` — both
     * values are the fallback verbatim.
     */
    hasOwnBound: boolean
}

/**
 * A layer's `dataStartTime`/`dataEndTime` extent, read the one way every
 * caller needs it: `dataEndTime` of `'now'` resolves to the current instant,
 * and a bound that is absent or fails to parse is completed from the supplied
 * fallback rather than left unset. The extent is read leniently, since
 * configs carry values in looser formats than ISO 8601.
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
        hasOwnBound: start !== null || end !== null,
    }
}

/**
 * The spans of the timeline a layer holds data for.
 *
 * A layer that carries data continuously is one span, running the length of
 * its configured extent. A sparse layer — data on a scattered handful of days
 * rather than throughout — lists those days instead, and gets one whole-day
 * span each, so the timeline shows the gaps rather than implying coverage the
 * layer does not have. Listing no days keeps the single continuous span.
 *
 * Days are read and bounded in UTC, matching every other instant the plugin
 * handles; snapping them locally would shift each box off the day it names by
 * the viewer's offset. A listed day must be written as ISO 8601, give or take
 * the surrounding whitespace a comma-separated list picks up — anything else
 * is dropped rather than guessed at, so a mistyped date costs the layer that
 * box rather than its whole row, and a list with nothing readable in it falls
 * back to the continuous span. The extent either side of it is read leniently,
 * since configs carry values in looser formats.
 */
export function resolveLayerTimeRanges(
    time: LayerTimeConfig | undefined,
    fallbackStart: Date,
    fallbackEnd: Date
): TimeRange[] {
    if (!time || time.enabled !== true)
        return [{ start: fallbackStart, end: fallbackEnd }]

    const listed = Array.isArray(time.dataDates)
        ? time.dataDates
        : typeof time.dataDates === 'string'
        ? [time.dataDates]
        : []

    const days = listed
        .map((date) => moment.utc(String(date).trim(), moment.ISO_8601, true))
        .filter((day) => day.isValid())
        .sort((a, b) => a.valueOf() - b.valueOf())

    if (days.length > 0)
        return days.map((day) => ({
            start: day.clone().startOf('day').toDate(),
            end: day.clone().endOf('day').toDate(),
            label: day.format('YYYY-MM-DD'),
        }))

    const { start, end } = resolveLayerExtent(time, fallbackStart, fallbackEnd)
    return [{ start, end }]
}
