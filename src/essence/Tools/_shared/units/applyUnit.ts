/**
 * Applies the map core hands out with a layer's unit (`shown = value ×
 * scale + offset`) to one number, and takes it back. Nothing here knows what
 * a unit is; core resolves that and plugins only do the arithmetic.
 */
export type UnitMap = { scale: number; offset: number }

// 18 × 0.001 is 0.018000000000000002 in floating point; twelve significant
// digits keep every real measurement and drop that noise.
const tidy = (value: number): number => Number(value.toPrecision(12))

export const applyUnit = <T>(value: T, unit: UnitMap | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return tidy(value * unit.scale + unit.offset)
}

export const unapplyUnit = <T>(value: T, unit: UnitMap | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return tidy((value - unit.offset) / unit.scale)
}
