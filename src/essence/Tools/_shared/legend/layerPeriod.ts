/**
 * Where a periodic layer's cursor sits, as a period rather than an instant.
 *
 * A layer carrying `time.interval` serves one period at a time — a month, a
 * week, six hours — so the honest thing to print is the period holding the
 * cursor, not the cursor itself. Pure arithmetic on ISO strings: no bus, no
 * formatting, so the rules are testable on their own. The ISO-duration
 * vocabulary itself is core's, read through layerTimePolicy.
 */

import {
    parseISODuration,
    addDuration,
    type Duration,
} from '../../../Basics/TimeControl_/layerTimePolicy'

/**
 * A period, as ISO instants. `end` is the next period's start — the period
 * runs up to but not including it — so consecutive periods read as a
 * continuous line rather than leaving a gap between them.
 */
export type LayerPeriod = { start: string; end: string }

// A period longer than this is not a mission cadence, it is a bug — stop
// stepping rather than spin. ~830 years at a one-month step.
const MAX_STEPS = 10000

const DAY_MS = 86_400_000

const toMs = (time: string | null | undefined): number | null => {
    if (typeof time !== 'string' || time.trim() === '') return null
    const ms = Date.parse(time)
    return Number.isNaN(ms) ? null : ms
}

const span = (start: number, end: number): LayerPeriod => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
})

// Built off the epoch so a year is written as given: new Date(Date.UTC(y, …))
// folds years 0 to 99 into the twentieth century. An out-of-range month rolls
// into the next year, so December's next boundary needs no special case.
const monthStart = (year: number, month: number): number => {
    const date = new Date(0)
    date.setUTCFullYear(year, month, 1)
    return date.getTime()
}

/**
 * The period for a duration that is exactly one calendar unit, which needs no
 * anchor: the calendar itself supplies the boundaries.
 */
const calendarPeriod = (
    duration: Duration,
    cursorMs: number,
): LayerPeriod | null => {
    const { years, months, weeks, days, hours, minutes, seconds } = duration
    const subDay = weeks + hours + minutes + seconds
    const cursor = new Date(cursorMs)
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    if (years === 1 && months + days + subDay === 0) {
        return span(monthStart(year, 0), monthStart(year + 1, 0))
    }
    if (months === 1 && years + days + subDay === 0) {
        return span(monthStart(year, month), monthStart(year, month + 1))
    }
    if (days === 1 && years + months + subDay === 0) {
        const start = Math.floor(cursorMs / DAY_MS) * DAY_MS
        return span(start, start + DAY_MS)
    }
    return null
}

const scaled = (duration: Duration, times: number): Duration => ({
    years: duration.years * times,
    months: duration.months * times,
    weeks: duration.weeks * times,
    days: duration.days * times,
    hours: duration.hours * times,
    minutes: duration.minutes * times,
    seconds: duration.seconds * times,
})

// Every step is measured from the anchor rather than from the previous step,
// so month arithmetic cannot accumulate the end-of-month clamp (a Jan 31
// anchor stepped by P1M twice reaches Mar 31, not Mar 28).
const addTo = (anchor: Date, duration: Duration, times: number): Date =>
    addDuration(anchor, scaled(duration, times), 1)

const fixedLengthMs = (duration: Duration): number | null => {
    if (duration.years > 0 || duration.months > 0) return null
    return (
        (((duration.days + duration.weeks * 7) * 24 + duration.hours) * 60 +
            duration.minutes) *
            60000 +
        duration.seconds * 1000
    )
}

/**
 * The period of length `interval` that holds `cursor`.
 *
 * A single calendar unit answers from the calendar alone. Anything else is
 * stepped forward from `anchor` — the layer's resolved data start — because
 * nothing else says where the layer's periods begin. Null whenever the
 * interval, the cursor, or (for an anchored duration) the anchor is missing
 * or unreadable, the interval is shorter than an hour, or the cursor sits
 * before the anchor: the caller then falls back to a range it can stand
 * behind without a cadence.
 */
export const layerPeriodFor = (
    interval: string | null | undefined,
    cursor: string | null | undefined,
    anchor: string | null | undefined,
): LayerPeriod | null => {
    const duration =
        typeof interval === 'string' ? parseISODuration(interval.trim()) : null
    if (!duration) return null
    // Anything under an hour is not a cadence of periods but a run of
    // individually timestamped scenes, and naming a period around one would
    // claim a coverage the layer never had.
    const length = fixedLengthMs(duration)
    if (length !== null && length < 3_600_000) return null
    const cursorMs = toMs(cursor)
    if (cursorMs === null) return null

    const calendar = calendarPeriod(duration, cursorMs)
    if (calendar) return calendar

    const anchorMs = toMs(anchor)
    if (anchorMs === null || cursorMs < anchorMs) return null

    if (length !== null) {
        const steps = Math.floor((cursorMs - anchorMs) / length)
        const start = anchorMs + steps * length
        return span(start, start + length)
    }

    const anchorDate = new Date(anchorMs)
    let steps = 0
    let end = addTo(anchorDate, duration, 1)
    while (end.getTime() <= cursorMs) {
        steps += 1
        if (steps > MAX_STEPS) return null
        end = addTo(anchorDate, duration, steps + 1)
    }
    return {
        start: addTo(anchorDate, duration, steps).toISOString(),
        end: end.toISOString(),
    }
}
