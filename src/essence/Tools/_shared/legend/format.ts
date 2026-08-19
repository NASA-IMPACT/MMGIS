// 3-significant-figure display with exponential fallback — the exact rules
// the in-app gradient bar uses, shared so exports can never disagree.
export const formatLegendValue = (val: number | string): string => {
    const num = Number(val)
    if (isNaN(num)) return String(val)
    if (num === 0) return '0'
    if (Math.abs(num) < 9999 && Math.abs(num) > 0.0009) {
        return String(parseFloat(num.toFixed(3)))
    }
    return num.toExponential(2)
}

export const formatLegendBound = (
    val: number | string,
    unit?: string | null,
): string => (unit ? `${formatLegendValue(val)} ${unit}` : formatLegendValue(val))
