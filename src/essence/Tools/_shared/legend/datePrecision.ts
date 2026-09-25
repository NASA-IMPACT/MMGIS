/**
 * How precisely a row's dates print.
 *
 * A layer's `time.interval` decides it, not the mission's time format: a
 * daily collection has no business printing seconds, and an hourly one is
 * unreadable rounded to a day. The smallest unit in the interval is the
 * finest thing a reader can tell apart, so it sets the precision. The
 * interval arrives already parsed, from `layers:getTemporalExtent`; this
 * module never reads the ISO-duration text itself.
 */

import { type CoverageUnit, type Duration } from '../adapters/mmgisAPI'
import { parseInstant } from './isoInstant'

type Precision = 'year' | 'month' | 'day' | 'hour' | 'second'

const precisionOf = (duration: Duration | null | undefined): Precision => {
    if (!duration) return 'day'
    if (duration.minutes > 0 || duration.seconds > 0) return 'second'
    if (duration.hours > 0) return 'hour'
    if (duration.days > 0 || duration.weeks > 0) return 'day'
    if (duration.months > 0) return 'month'
    if (duration.years > 0) return 'year'
    return 'day'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * An epoch moment written at `precision`, or null when it is not a moment a
 * date can hold.
 */
const formatEpochMsAt = (precision: Precision, ms: number): string | null => {
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return null
    // Years before 1000 still print as four digits, so a date is the same
    // width wherever it lands.
    const year = `${date.getUTCFullYear()}`.padStart(4, '0')
    const month = `${year}-${pad(date.getUTCMonth() + 1)}`
    const day = `${month}-${pad(date.getUTCDate())}`
    switch (precision) {
        case 'year':
            return year
        case 'month':
            return month
        case 'hour':
            return `${day}T${pad(date.getUTCHours())}:00Z`
        case 'second':
            return `${day}T${pad(date.getUTCHours())}:${pad(
                date.getUTCMinutes(),
            )}:${pad(date.getUTCSeconds())}Z`
        default:
            return day
    }
}

/** An epoch moment written at the precision `duration` earns. */
const formatEpochMs = (
    duration: Duration | null | undefined,
    ms: number,
): string | null => formatEpochMsAt(precisionOf(duration), ms)

/**
 * An epoch moment written at the precision of a named unit — `2025` for a
 * year, `2025-03-09T14:00Z` for an hour — or null when it is not a moment a
 * date can hold. For a date whose own unit is known, such as a listed Data
 * Dates entry, rather than one a layer's interval sets the precision for.
 */
export const formatEpochMsAtUnit = (
    unit: CoverageUnit,
    ms: number,
): string | null => formatEpochMsAt(unit, ms)

/**
 * `instant` written at the precision `duration` earns, or null when it is
 * not a time at all — the caller then drops the line rather than printing
 * half a range.
 */
export const formatAtPrecision = (
    duration: Duration | null | undefined,
    instant: string | null | undefined,
): string | null => {
    const parsed = parseInstant(instant)
    return parsed && formatEpochMs(duration, parsed.ms)
}
