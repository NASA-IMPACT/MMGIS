// 3-significant-figure display with exponential fallback — the exact rules
// the in-app gradient bar uses, shared so exports can never disagree.
// Missing bounds (null/undefined, or an empty/blank string — which `Number`
// would otherwise silently read as 0) render blank rather than '0'.
export const formatLegendValue = (
    val: number | string | null | undefined,
): string => {
    if (val == null) return ''
    if (typeof val === 'string' && val.trim() === '') return ''
    const num = Number(val)
    if (isNaN(num)) return String(val)
    if (num === 0) return '0'
    if (Math.abs(num) < 9999 && Math.abs(num) > 0.0009) {
        return String(parseFloat(num.toFixed(3)))
    }
    return num.toExponential(2)
}

const isNumericBound = (val: number | string | null | undefined): boolean => {
    if (typeof val === 'number') return !isNaN(val)
    if (typeof val === 'string' && val.trim() !== '') return !isNaN(Number(val))
    return false
}

// A unit is appended only for a bound that actually rendered as a number —
// a non-numeric bound (e.g. '<0.1 ppm') already carries its unit as part of
// the string, so appending again would double it ('ppm ppm').
export const formatLegendBound = (
    val: number | string | null | undefined,
    unit?: string | null,
): string => {
    const formatted = formatLegendValue(val)
    if (!formatted) return ''
    return unit && isNumericBound(val) ? `${formatted} ${unit}` : formatted
}
