// Colormap naming, gradient building, and rescale validation.
//
// TiTiler encodes a ramp's direction in its name: `viridis` is the forward
// ramp, `viridis_r` the reversed one, and `/colorMaps` reports both. The UI
// treats direction as a separate toggle rather than two list entries, so these
// helpers split a name into (base, reversed) and recombine it on apply.

const REVERSED_SUFFIX = /_r$/i

export const isReversedColormap = (name: string | null | undefined): boolean =>
    typeof name === 'string' && REVERSED_SUFFIX.test(name)

export const getBaseColormapName = (name: string | null | undefined): string => {
    if (!name) return ''
    return name.replace(REVERSED_SUFFIX, '')
}

/** Recombine a base ramp name with a direction into the name TiTiler expects. */
export const applyColormapDirection = (base: string, reversed: boolean): string => {
    const normalized = getBaseColormapName(base).toLowerCase()
    if (!normalized) return normalized
    return reversed ? `${normalized}_r` : normalized
}

/**
 * Whether a ramp can be offered reversed: when the host lists its `_r` form.
 * With no list to consult, every ramp is offered both ways.
 */
export const canReverseColormap = (
    base: string,
    available: string[] | null | undefined,
): boolean => {
    if (!available) return true
    const reversed = `${getBaseColormapName(base).toLowerCase()}_r`
    return available.some((name) => name.toLowerCase() === reversed)
}

/** Title-cased ramp name for display, e.g. `rd_yl_bu` -> `Rd yl bu`. */
export const formatColormapLabel = (name: string): string => {
    const base = getBaseColormapName(name)
    if (!base) return ''
    return base.charAt(0).toUpperCase() + base.slice(1).replace(/_/g, ' ')
}

/** Forward-only ramp names, deduplicated and alphabetized. */
export const toForwardColormapNames = (names: string[] | null | undefined): string[] => {
    if (!names) return []
    const forward = new Set<string>()
    names.forEach((name) => {
        if (!isReversedColormap(name)) forward.add(name)
    })
    return [...forward].sort((a, b) => a.localeCompare(b))
}

/**
 * Build the CSS `linear-gradient` a swatch or legend bar paints. An empty or
 * single-color ramp has no gradient to interpolate, so it falls back to a flat
 * fill.
 */
export const buildGradientCss = (colors: string[] | null | undefined): string => {
    if (!colors || colors.length === 0) return 'transparent'
    if (colors.length === 1) return colors[0]
    const step = 100 / (colors.length - 1)
    return `linear-gradient(to right, ${colors
        .map((color, i) => `${color} ${i * step}%`)
        .join(', ')})`
}

export type RescaleValidation =
    | { valid: true; min: number; max: number }
    | { valid: false }

/**
 * Accept a rescale range only when both bounds parse as finite numbers and the
 * range spans a nonzero width — a zero-width range leaves the layer with an
 * undefined value-to-color mapping.
 */
export const validateRescale = (
    minInput: string | number,
    maxInput: string | number,
): RescaleValidation => {
    // `Number` rather than `parseFloat` so trailing garbage ("5abc") fails
    // outright instead of silently parsing as 5; the empty string, which
    // `Number` reads as 0, is rejected first.
    const toNumber = (input: string | number): number => {
        if (typeof input === 'number') return input
        const trimmed = input.trim()
        return trimmed === '' ? NaN : Number(trimmed)
    }
    const min = toNumber(minInput)
    const max = toNumber(maxInput)
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { valid: false }
    if (min >= max) return { valid: false }
    return { valid: true, min, max }
}
