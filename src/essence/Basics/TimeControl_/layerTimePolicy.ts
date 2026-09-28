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
 * The same interval decides what a raster tile layer requests at each time
 * step: the one period holding the cursor (see `layerRequestWindow`) —
 * unless the layer lists Data Dates, which then decide on their own.
 *
 * Core owns this vocabulary. Plugins never resolve it themselves: they ask
 * `layers:getTemporalExtent` and receive plain ISO datetimes.
 */

import { hasListedEntries } from './listedDates'

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

// Durations are unbounded, so date math can land outside the +/-273,790-year
// range a Date can represent, where toISOString() throws. Every other failure
// in this module resolves to null and must here too: `layers:getTemporalExtent`
// resolves every layer in one pass, so one unbounded config would otherwise
// reject the whole request and leave consumers with no extents at all.
function toIso(date: Date): string | null {
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('.')[0] + 'Z'
}

/**
 * Resolves a data time value — concrete or policy — to an ISO datetime
 * string, or null when the value is absent, unparseable, or resolves
 * outside the range a Date can represent (callers keep their own
 * fallback; a bad value must never break a consumer).
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
            const snapped = toIso(
                floorToStep(new Date(start), new Date(end), cadence)
            )
            // An out-of-range step leaves the extent unsnapped, exactly as
            // an unparseable interval does.
            if (snapped != null) end = snapped
        }
    }
    return { start, end }
}

/** The shape of `time` fields read to decide a layer's request window. */
export interface RequestTimeConfig {
    enabled?: boolean | null
    type?: string | null
    interval?: string | null
    dataStartTime?: string | null
    dataDates?: string[] | string | null
}

export interface RequestWindow {
    start: string
    end: string
    periodic: boolean
}

const MS_PER_HOUR = 3600000

// Cadences that line up with UTC calendar boundaries when a layer names no
// anchor. Weeks are left out on purpose: without an anchor there is no
// telling whether a week starts on Sunday or Monday.
const CALENDAR_UNITS: Array<[keyof Duration, 'year' | 'month' | 'day' | 'hour']> = [
    ['years', 'year'],
    ['months', 'month'],
    ['days', 'day'],
    ['hours', 'hour'],
]

// A cadence of exactly one year, month, day or hour, named by its unit, or
// null for anything else.
function calendarUnitOf(
    d: Duration
): 'year' | 'month' | 'day' | 'hour' | null {
    const nonZero = (Object.keys(d) as Array<keyof Duration>).filter(
        (k) => d[k] !== 0
    )
    if (nonZero.length !== 1 || d[nonZero[0]] !== 1) return null
    const match = CALENDAR_UNITS.find(([key]) => key === nonZero[0])
    return match ? match[1] : null
}

// The UTC calendar year/month/day/hour holding `at`, as [start, next start).
function calendarPeriod(
    at: Date,
    unit: 'year' | 'month' | 'day' | 'hour'
): [Date, Date] {
    const y = at.getUTCFullYear()
    const mo = unit === 'year' ? 0 : at.getUTCMonth()
    const day = unit === 'year' || unit === 'month' ? 1 : at.getUTCDate()
    const h = unit === 'hour' ? at.getUTCHours() : 0
    const start = new Date(Date.UTC(y, mo, day, h))
    // Date.UTC treats years 0-99 as 1900-1999; setUTCFullYear does not.
    start.setUTCFullYear(y)
    const end = new Date(start)
    if (unit === 'year') end.setUTCFullYear(y + 1)
    else if (unit === 'month') end.setUTCMonth(mo + 1)
    else if (unit === 'day') end.setUTCDate(day + 1)
    else end.setUTCHours(h + 1)
    return [start, end]
}

// A fixed anchor for period boundaries: a concrete dataStartTime only. A
// policy string ("now", "now - P1Y") slides with the wall clock and would
// drag the boundaries along with it, so it anchors nothing.
function anchorOf(time: RequestTimeConfig): Date | null {
    const raw = time.dataStartTime
    if (raw == null || raw === '') return null
    if (POLICY_RE.test(String(raw).trim())) return null
    const anchor = new Date(raw)
    return isNaN(anchor.getTime()) ? null : anchor
}

// The cadence a layer requests one period of at a time, or null when the
// layer is not periodic: time off, a `local` layer, a layer that lists at
// least one readable Data Dates entry (the listed dates decide when it has
// data, read as the coverage gate reads them), no or unparseable interval,
// or a cadence shorter than an hour — that is a run of individually
// timestamped scenes, not a period.
function requestCadenceOf(
    time: RequestTimeConfig | null | undefined
): Duration | null {
    if (time == null || time.enabled !== true) return null
    if (time.type === 'local') return null
    if (hasListedEntries(time.dataDates)) return null
    if (time.interval == null || time.interval === '') return null
    const cadence = parseISODuration(String(time.interval).trim())
    if (cadence == null || approximateMs(cadence) < MS_PER_HOUR) return null
    return cadence
}

// The period [start, next start) holding `cursor`, or null when the layer
// has no period there.
function periodAt(
    time: RequestTimeConfig,
    cadence: Duration,
    cursor: Date
): [Date, Date] | null {
    const anchor = anchorOf(time)
    if (anchor != null) {
        if (cursor.getTime() < anchor.getTime()) return null
        const stepAt = (n: number) => addDuration(anchor, cadence, n)
        let n = Math.max(
            0,
            Math.floor(
                (cursor.getTime() - anchor.getTime()) / approximateMs(cadence)
            )
        )
        while (stepAt(n + 1).getTime() <= cursor.getTime()) n++
        while (n > 0 && stepAt(n).getTime() > cursor.getTime()) n--
        // Both edges come from the anchor: a Jan 31 anchor stepped by P1M
        // overflows through short months, so start + cadence could overlap
        // the next period.
        return [stepAt(n), stepAt(n + 1)]
    }
    const unit = calendarUnitOf(cadence)
    return unit == null ? null : calendarPeriod(cursor, unit)
}

/**
 * The window a layer requests at the cursor.
 *
 * A periodic layer (`time.interval` of an hour or more, not `local`, no
 * readable Data Dates) requests the one period holding the cursor. Periods step from a concrete
 * `dataStartTime`; without one, a cadence of exactly P1Y, P1M, P1D or PT1H
 * follows UTC calendar boundaries. `end` is the period's last inclusive
 * second, because STAC `datetime=a/b` intervals are closed at both ends and
 * an exclusive next-period end would pull in items stamped at its first
 * instant.
 *
 * Every other layer — and a periodic one whose period cannot be placed
 * (cursor before the anchor, no anchor for a non-calendar cadence, date
 * math out of range) — requests `[windowStart, cursor]`, the Time Control
 * window.
 *
 * @param time - The layer config's `time` block.
 * @param windowStart - The Time Control window start.
 * @param cursor - The Time Control current time.
 */
export function layerRequestWindow(
    time: RequestTimeConfig | null | undefined,
    windowStart: string,
    cursor: string
): RequestWindow {
    const passthrough = { start: windowStart, end: cursor, periodic: false }
    const cadence = requestCadenceOf(time)
    if (cadence == null || time == null) return passthrough

    const at = new Date(cursor)
    if (isNaN(at.getTime())) return passthrough
    const period = periodAt(time, cadence, at)
    if (period == null) return passthrough

    const start = toIso(period[0])
    const end = toIso(new Date(period[1].getTime() - 1000))
    if (start == null || end == null) return passthrough
    return { start, end, periodic: true }
}

/**
 * Whether `layerRequestWindow` requests one period for this layer at the
 * cursor. Without a cursor, whether the layer is periodic at all.
 */
export function isPeriodicRequest(
    time: RequestTimeConfig | null | undefined,
    cursor?: string
): boolean {
    const cadence = requestCadenceOf(time)
    if (cadence == null || time == null) return false
    if (cursor == null)
        return anchorOf(time) != null || calendarUnitOf(cadence) != null
    return layerRequestWindow(time, cursor, cursor).periodic
}
