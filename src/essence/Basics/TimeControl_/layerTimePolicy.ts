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
 * A periodic layer additionally declares `time.interval`, an ISO-8601
 * duration ("P7D"): data exists only at start-anchored steps, so the
 * extent's end floors to the last step at or before the resolved end —
 * a 7-day cadence that began ten days ago ended three days ago, not now.
 *
 * Core owns this vocabulary. Plugins never resolve it themselves: they ask
 * `layers:getTemporalExtent` and receive plain ISO datetimes.
 */

const DURATION_RE =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

const POLICY_RE = /^now(?:\s*([+-])\s*(\S+))?$/

interface Duration {
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
    if (![years, months, weeks, days, hours, minutes, seconds].some((v) => v))
        return null
    return {
        years: Number(years || 0),
        months: Number(months || 0),
        weeks: Number(weeks || 0),
        days: Number(days || 0),
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
    }
}

// Months and years are not fixed millisecond amounts — apply them with UTC
// date-component math, never ms arithmetic. Applying `factor × d` in one
// pass keeps a month cadence anchored to the start's day-of-month instead
// of drifting through short months.
function addDuration(date: Date, d: Duration, factor: number): Date {
    const out = new Date(date)
    out.setUTCFullYear(out.getUTCFullYear() + factor * d.years)
    out.setUTCMonth(out.getUTCMonth() + factor * d.months)
    out.setUTCDate(out.getUTCDate() + factor * (d.days + 7 * d.weeks))
    out.setUTCHours(out.getUTCHours() + factor * d.hours)
    out.setUTCMinutes(out.getUTCMinutes() + factor * d.minutes)
    out.setUTCSeconds(out.getUTCSeconds() + factor * d.seconds)
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

export interface TemporalExtent {
    start: string | null
    end: string | null
}

const MS_PER_DAY = 86400000

// Rough length of one cadence step, only to seed the step count — the
// exact landing is settled by calendar math below.
function approximateMs(d: Duration): number {
    return (
        (d.years * 365.2425 + d.months * 30.436875 + d.weeks * 7 + d.days) *
            MS_PER_DAY +
        d.hours * 3600000 +
        d.minutes * 60000 +
        d.seconds * 1000
    )
}

// Last start-anchored step at or before `end`: start + N × cadence for the
// largest N ≥ 0 that fits. An end before start clamps to the start itself.
function floorToStep(start: Date, end: Date, cadence: Duration): Date {
    const stepAt = (n: number) => addDuration(start, cadence, n)
    let n = Math.max(
        0,
        Math.floor(
            (end.getTime() - start.getTime()) / approximateMs(cadence)
        )
    )
    while (stepAt(n + 1).getTime() <= end.getTime()) n++
    while (n > 0 && stepAt(n).getTime() > end.getTime()) n--
    return stepAt(n)
}

/**
 * Resolves a layer's `time` block to its temporal extent: both data time
 * policies resolved, and — when the layer declares a periodic `interval`
 * (ISO-8601 duration) — the end floored to the last start-anchored step,
 * since no data exists between steps. An unparseable interval, or one
 * without a resolvable start to anchor to, leaves the extent unsnapped.
 *
 * @param time - The layer config's `time` block.
 * @param options.now - Injectable current moment (tests).
 */
export function resolveTemporalExtent(
    time:
        | {
              dataStartTime?: string | null
              dataEndTime?: string | null
              interval?: string | null
          }
        | null
        | undefined,
    options: { now?: Date } = {}
): TemporalExtent {
    const start = resolveTimePolicy(time?.dataStartTime, options)
    let end = resolveTimePolicy(time?.dataEndTime, options)

    if (start != null && end != null && time?.interval != null) {
        const cadence = parseISODuration(String(time.interval).trim())
        // A zero cadence ("P0D") parses but cannot step anywhere.
        if (cadence != null && approximateMs(cadence) > 0) {
            end = toIso(floorToStep(new Date(start), new Date(end), cadence))
        }
    }
    return { start, end }
}
