/**
 * How precisely a row's dates print.
 *
 * A layer's `time.interval` decides it, not the mission's time format: a
 * daily collection has no business printing seconds, and an hourly one is
 * unreadable rounded to a day. The smallest unit in the interval is the
 * finest thing a reader can tell apart, so it sets the precision. Pure
 * string arithmetic on the ISO-duration vocabulary core owns.
 */

import { type Duration } from '../../../Basics/TimeControl_/layerTimePolicy'

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
 * An epoch moment written at the precision `duration` earns, or null when it
 * is not a moment a date can hold.
 */
const formatEpochMs = (
    duration: Duration | null | undefined,
    ms: number,
): string | null => {
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return null
    // Years before 1000 still print as four digits, so a date is the same
    // width wherever it lands.
    const year = `${date.getUTCFullYear()}`.padStart(4, '0')
    const month = `${year}-${pad(date.getUTCMonth() + 1)}`
    const day = `${month}-${pad(date.getUTCDate())}`
    switch (precisionOf(duration)) {
        case 'year':
            return year
        case 'month':
            return month
        case 'hour':
            return `${day} ${pad(date.getUTCHours())}:00Z`
        case 'second':
            return `${day}T${pad(date.getUTCHours())}:${pad(
                date.getUTCMinutes(),
            )}:${pad(date.getUTCSeconds())}Z`
        default:
            return day
    }
}

/**
 * `instant` written at the precision `duration` earns, or null when it is
 * not a time at all — the caller then drops the line rather than printing
 * half a range.
 */
export const formatAtPrecision = (
    duration: Duration | null | undefined,
    instant: string | null | undefined,
): string | null =>
    formatEpochMs(
        duration,
        typeof instant === 'string' ? Date.parse(instant) : NaN,
    )

/**
 * A period's end, printed inclusively. The end a period carries is the
 * instant the next one starts on, so printing it raw would make a P7D period
 * read as eight days; what prints is the last unit the period covers.
 */
export const formatPeriodEnd = (
    duration: Duration | null | undefined,
    exclusiveEnd: string | null | undefined,
): string | null =>
    formatEpochMs(
        duration,
        typeof exclusiveEnd === 'string' ? Date.parse(exclusiveEnd) - 1 : NaN,
    )
