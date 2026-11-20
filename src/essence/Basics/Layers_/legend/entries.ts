// The entries a layer's `_legend` declares, and what can be read off them.

export type LegendEntry = {
    shape?: string
    color?: string
    value?: string | number
    label?: string
    hideFromLegend?: boolean
}

/** The shapes that make an entry part of a continuous scale rather than a swatch. */
const SCALE_SHAPES = ['continuous', 'discreet']

const NUMERIC_PREFIX = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/

type NumericValue = { number: number; unit: string }

/**
 * Reads a legend value as a number plus an optional trailing unit
 * (`'0.5 ppm'` -> 0.5 + 'ppm'). Null for anything that is not a plain number:
 * a word (`'example'`), or a binned label (`'0.5-1.0 m'`) whose remainder
 * reads as another number rather than as a unit.
 */
export const parseNumericValue = (
    value: string | number | undefined
): NumericValue | null => {
    const str = String(value ?? '').trim()
    const match = str.match(NUMERIC_PREFIX)
    if (!match) return null
    const unit = str.slice(match[0].length).trim()
    if (/^[+\-.\d]/.test(unit)) return null
    return { number: parseFloat(match[0]), unit }
}

/**
 * The numbers and shared unit behind a run of scale entries, or null when the
 * run is not one honest numeric scale: some value is not a number, or the
 * entries disagree on their unit (which is what a set of binned labels looks
 * like once each bin's remainder is read as a unit).
 */
export const readScaleValues = (
    entries: LegendEntry[]
): { numbers: number[]; unit: string | null } | null => {
    const parsed = entries.map((entry) => parseNumericValue(entry.value))
    if (parsed.some((value) => value === null)) return null
    const values = parsed as NumericValue[]
    const units = new Set(values.map((value) => value.unit))
    if (units.size > 1) return null
    const [unit] = [...units]
    return { numbers: values.map((value) => value.number), unit: unit || null }
}

/**
 * Whether every entry is part of a scale — a ramp, whatever its labels say.
 * An empty run is not one: `every` answers true for it, and a gradient read
 * off it would span Infinity.
 */
export const isScale = (entries: LegendEntry[]): boolean =>
    entries.length > 0 &&
    entries.every((entry) => SCALE_SHAPES.includes(entry.shape ?? ''))

/**
 * The entries worth drawing: whatever the layer declared, minus the ones the
 * author hid and minus any hole a hand-written config left behind. A hidden
 * nodata class is not a swatch and its value is not a bound, so both are
 * dropped before anything is read off them.
 */
export const readEntries = (declared: unknown): LegendEntry[] =>
    Array.isArray(declared)
        ? declared.filter(
              (entry): entry is LegendEntry =>
                  entry != null &&
                  typeof entry === 'object' &&
                  (entry as LegendEntry).hideFromLegend !== true
          )
        : []
