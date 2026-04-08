/**
 * Value formatting utilities for LayerManager components
 */

/**
 * Format a numeric value for display
 * @param {number|string} value - The value to format
 * @param {number} maxDecimals - Maximum decimal places (default: 2)
 * @returns {string} Formatted value string
 */
export const formatValue = (value, maxDecimals = 2) => {
    if (value === null || value === undefined) return ''

    const num = typeof value === 'string' ? parseFloat(value) : value

    if (isNaN(num)) return String(value)

    // For whole numbers, don't show decimals
    if (Number.isInteger(num)) return String(num)

    // For decimals, limit precision
    return num.toFixed(maxDecimals).replace(/\.?0+$/, '')
}

/**
 * Format min/max range for display
 * @param {number|string} min - Minimum value
 * @param {number|string} max - Maximum value
 * @param {string} unit - Optional unit string
 * @returns {string} Formatted range string
 */
export const formatRange = (min, max, unit = '') => {
    const minStr = formatValue(min)
    const maxStr = formatValue(max)
    const unitStr = unit ? ` ${unit}` : ''
    return `${minStr} - ${maxStr}${unitStr}`
}

/**
 * Format percentage value
 * @param {number} value - Value between 0 and 1
 * @returns {string} Percentage string (e.g., "75%")
 */
export const formatPercent = (value) => {
    return `${Math.round(value * 100)}%`
}

/**
 * Interpolate a value between min and max based on a position (0-1)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} position - Position between 0 and 1
 * @returns {number} Interpolated value
 */
export const interpolateValue = (min, max, position) => {
    const minNum = typeof min === 'string' ? parseFloat(min) : min
    const maxNum = typeof max === 'string' ? parseFloat(max) : max

    if (isNaN(minNum) || isNaN(maxNum)) return null

    return minNum + (maxNum - minNum) * position
}
