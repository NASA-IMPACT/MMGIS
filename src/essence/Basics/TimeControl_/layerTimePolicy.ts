/**
 * Layer time policies: a layer's `dataStartTime`/`dataEndTime` may be a
 * concrete ISO datetime — or a policy string that stays true as time
 * passes, so configs for growing/forecast collections never go stale:
 *
 *   "now"            the current moment
 *   "now - P1D"      an ISO-8601 duration before now
 *   "now + P5D"      a duration after now (forecast windows)
 *
 * "now" resolves to the raw current moment, never rounded — matching
 * veda-ui, which normalizes an ongoing (null-ended) STAC domain to the
 * current datetime as-is.
 *
 * Core owns this vocabulary. Plugins never resolve it themselves: they ask
 * `layers:getTemporalExtent` and receive plain ISO datetimes.
 */

const DURATION_RE =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

const POLICY_RE = /^now(?:\s*([+-])\s*(\S+))?$/

export interface Duration {
    years: number
    months: number
    weeks: number
    days: number
    hours: number
    minutes: number
    seconds: number
}

export function parseISODuration(value: string): Duration | null {
    const m = DURATION_RE.exec(value)
    if (!m || value === 'P' || value.endsWith('T')) return null
    const [, years, months, weeks, days, hours, minutes, seconds] = m
    const duration = {
        years: Number(years || 0),
        months: Number(months || 0),
        weeks: Number(weeks || 0),
        days: Number(days || 0),
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
    }
    // A zero-length duration ("P0D") is no duration at all: nothing to offset
    // by, and no period it could ever contain.
    const total = Object.values(duration).reduce((sum, part) => sum + part, 0)
    return total > 0 ? duration : null
}

// Months and years are not fixed millisecond amounts — apply them with UTC
// date-component math, never ms arithmetic.
export function addDuration(date: Date, d: Duration, sign: 1 | -1): Date {
    const out = new Date(date)
    out.setUTCFullYear(out.getUTCFullYear() + sign * d.years)
    out.setUTCMonth(out.getUTCMonth() + sign * d.months)
    out.setUTCDate(out.getUTCDate() + sign * (d.days + 7 * d.weeks))
    out.setUTCHours(out.getUTCHours() + sign * d.hours)
    out.setUTCMinutes(out.getUTCMinutes() + sign * d.minutes)
    out.setUTCSeconds(out.getUTCSeconds() + sign * d.seconds)
    return out
}

function toIso(date: Date): string {
    return date.toISOString().split('.')[0] + 'Z'
}

/**
 * Resolves a data time value — concrete or policy — to an ISO datetime
 * string, or null when the value is absent or unparseable (callers keep
 * their own fallback; a bad value must never break a consumer).
 *
 * @param value - `time.dataStartTime` / `time.dataEndTime`.
 * @param options.now - Injectable current moment (tests).
 */
export function resolveTimePolicy(
    value: string | null | undefined,
    options: { now?: Date } = {}
): string | null {
    if (value == null || value === '') return null

    const policy = POLICY_RE.exec(value.trim())
    if (policy == null) {
        const concrete = new Date(value)
        return isNaN(concrete.getTime()) ? null : toIso(concrete)
    }

    let resolved = options.now != null ? new Date(options.now) : new Date()
    const [, sign, offset] = policy
    if (offset != null) {
        const duration = parseISODuration(offset)
        if (duration == null) return null
        resolved = addDuration(resolved, duration, sign === '-' ? -1 : 1)
    }
    return toIso(resolved)
}
