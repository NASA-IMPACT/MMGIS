/**
 * A layer's Data Time Interval: the ISO 8601 duration its data repeats at,
 * such as `P1D`, `P7D` or `P1M`. Read with the grammar core reads it with,
 * held here rather than imported so the plugin reaches core only over the bus.
 *
 * Every calculation is UTC, like the rest of the plugin.
 */
export interface Duration {
    years: number
    months: number
    weeks: number
    days: number
    hours: number
    minutes: number
    seconds: number
}

const DURATION_RE =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

const MS_SECOND = 1000
const MS_MINUTE = 60 * MS_SECOND
const MS_HOUR = 60 * MS_MINUTE
const MS_DAY = 24 * MS_HOUR

/**
 * The duration a string names, or null when it names none: it is not a
 * duration, names no component, names only zeros, a cadence that cannot step
 * anywhere, or names a number too long to hold.
 */
export function parseDuration(value: unknown): Duration | null {
    if (typeof value !== 'string') return null
    const text = value.trim()
    const m = DURATION_RE.exec(text)
    if (!m || text === 'P' || text.endsWith('T')) return null
    const [, years, months, weeks, days, hours, minutes, seconds] = m
    const d: Duration = {
        years: Number(years || 0),
        months: Number(months || 0),
        weeks: Number(weeks || 0),
        days: Number(days || 0),
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
    }
    const shortest = shortestStepMs(d)
    return shortest > 0 && Number.isFinite(shortest) ? d : null
}

/**
 * The instant `steps` whole durations from `anchor`. Applied in one pass from
 * the anchor, so a monthly cadence keeps the anchor's day of the month rather
 * than drifting through the short months: Jan 31 steps to Feb 28, then
 * Mar 31. Months and years are calendar arithmetic, never a fixed length.
 */
export function addSteps(anchor: Date, d: Duration, steps: number): Date {
    const out = new Date(anchor)
    const years = steps * d.years
    const months = steps * d.months
    if (years !== 0 || months !== 0) {
        // Set as one year-and-month move, clamped to the target month's
        // length, so a 31st lands on the month's last day instead of
        // overflowing into the next month.
        const day = out.getUTCDate()
        out.setUTCDate(1)
        out.setUTCFullYear(out.getUTCFullYear() + years)
        out.setUTCMonth(out.getUTCMonth() + months)
        const monthLength = new Date(
            Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)
        ).getUTCDate()
        out.setUTCDate(Math.min(day, monthLength))
    }
    const fixedMs =
        (d.weeks * 7 + d.days) * MS_DAY +
        d.hours * MS_HOUR +
        d.minutes * MS_MINUTE +
        d.seconds * MS_SECOND
    return new Date(out.getTime() + steps * fixedMs)
}

/** A step's average length, only for estimating how many steps a span holds. */
function averageStepMs(d: Duration): number {
    return (
        (d.years * 365.2425 + d.months * 30.436875 + d.weeks * 7 + d.days) *
            MS_DAY +
        d.hours * MS_HOUR +
        d.minutes * MS_MINUTE +
        d.seconds * MS_SECOND
    )
}

/**
 * The shortest a step can be, with each month at 28 days and each year at 365,
 * for deciding whether neighbouring steps sit far enough apart to draw.
 */
export function shortestStepMs(d: Duration): number {
    return (
        (d.years * 365 + d.months * 28 + d.weeks * 7 + d.days) * MS_DAY +
        d.hours * MS_HOUR +
        d.minutes * MS_MINUTE +
        d.seconds * MS_SECOND
    )
}

/**
 * The index of the last step at or before `at`: the largest `n` for which
 * `addSteps(anchor, d, n)` is not after `at`. Negative when `at` precedes the
 * anchor. Seeded from the average step length and settled by calendar
 * arithmetic, so it costs a few steps wherever `at` lies.
 */
export function stepIndexAtOrBefore(anchor: Date, d: Duration, at: Date): number {
    const target = at.getTime()
    let n = Math.floor((target - anchor.getTime()) / averageStepMs(d))
    while (addSteps(anchor, d, n + 1).getTime() <= target) n++
    while (addSteps(anchor, d, n).getTime() > target) n--
    return n
}
