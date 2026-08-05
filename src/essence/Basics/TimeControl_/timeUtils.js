/**
 * Time utility functions for TimeControl and TimeUI
 * Shared utilities for parsing and manipulating time strings
 */

/**
 * Parses a date string with optional additional seconds offset
 * Supports format: "2024-03-04T14:05:00Z + 10000000" or "2024-03-04T14:05:00Z - 5000"
 *
 * @param {string} timeString - Date string with optional " + N" or " - N" suffix
 * @returns {Object} { dateString: string, additionalSeconds: number }
 *
 * @example
 * parseTimeWithOffset("2024-01-01T00:00:00Z + 3600")
 * // Returns: { dateString: "2024-01-01T00:00:00Z", additionalSeconds: 3600 }
 *
 * parseTimeWithOffset("2024-01-01T00:00:00Z - 1800")
 * // Returns: { dateString: "2024-01-01T00:00:00Z", additionalSeconds: -1800 }
 */
export function parseTimeWithOffset(timeString) {
    let dateString = timeString
    let offsetSign = 1
    let additionalSeconds = 0
    if (typeof dateString === 'string') {
        const indexPlus = dateString.indexOf(' + ')
        const indexMinus = dateString.indexOf(' - ')
        if (indexPlus > -1 || indexMinus > -1) {
            if (indexMinus > indexPlus) offsetSign = -1
            const dateAndOffsetParts = dateString.split(
                ` ${offsetSign === 1 ? '+' : '-'} `
            )
            dateString = dateAndOffsetParts[0]
            additionalSeconds = parseInt(dateAndOffsetParts[1]) || 0
            additionalSeconds = isNaN(additionalSeconds)
                ? 0
                : additionalSeconds
        }
        additionalSeconds *= offsetSign
    }
    return { dateString, additionalSeconds }
}

/**
 * Parses a time string and converts it to seconds
 * Supports both "hh:mm:ss" format and plain seconds
 *
 * @param {string|number} t - Time string in "hh:mm:ss" format or number of seconds
 * @returns {number} Total seconds (negative if prefixed with '-'); 0 for null/undefined
 *
 * @example
 * parseTimeToSeconds("01:30:00") // Returns: 5400 (1.5 hours)
 * parseTimeToSeconds("-02:00:00") // Returns: -7200 (-2 hours)
 * parseTimeToSeconds("3600") // Returns: 3600
 * parseTimeToSeconds(3600) // Returns: 3600
 */
export function parseTimeToSeconds(t) {
    if (t == null) return 0
    if (t.toString().indexOf(':') === -1) {
        return parseInt(t)
    }
    var hmsParts = t.split(':')
    var seconds =
        +hmsParts[0].replace('-', '') * 60 * 60 +
        +hmsParts[1] * 60 +
        +hmsParts[2]
    if (t.charAt(0) === '-') {
        seconds = seconds * -1
    }
    return seconds
}
