export const formatValue = (value: number | string | null | undefined, maxDecimals = 2): string => {
    if (value === null || value === undefined) return ''
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(num)) return String(value)
    if (Number.isInteger(num)) return String(num)
    return num.toFixed(maxDecimals).replace(/\.?0+$/, '')
}

export const formatRange = (min: number | string, max: number | string, unit = ''): string => {
    const minStr = formatValue(min)
    const maxStr = formatValue(max)
    const unitStr = unit ? ` ${unit}` : ''
    return `${minStr} - ${maxStr}${unitStr}`
}

export const formatPercent = (value: number): string => `${Math.round(value * 100)}%`

export const interpolateValue = (
    min: number | string,
    max: number | string,
    position: number,
): number | null => {
    const minNum = typeof min === 'string' ? parseFloat(min) : min
    const maxNum = typeof max === 'string' ? parseFloat(max) : max
    if (isNaN(minNum) || isNaN(maxNum)) return null
    return minNum + (maxNum - minNum) * position
}
