// Colormap list parsing, gradient building, and rescale validation, on top of
// the core-owned naming primitives.
//
// TiTiler encodes a ramp's direction in its name: `viridis` is the forward
// ramp, `viridis_r` the reversed one, and `/colorMaps` reports both. The UI
// treats direction as a separate toggle rather than two list entries, so the
// naming helpers split a name into (base, reversed) and this module recombines
// it on apply. Those helpers live in core (Basics/Colormaps/colormapNaming),
// which the raster renderer resolves its own names through; re-exporting them
// here keeps one source of truth without core reaching into a plugin
// directory for it.
import {
    isReversedColormap,
    getBaseColormapName,
    findColormapKey,
} from '../../../Basics/Colormaps/colormapNaming'

export { isReversedColormap, getBaseColormapName, findColormapKey }

export type ColormapListResponse = {
    // TiTiler <= 0.22 reports a flat array of names under `colorMaps`.
    colorMaps?: unknown
    // Later releases spell the key `colormaps` and carry each ramp as an
    // object holding its name and links.
    colormaps?: unknown
}

/** Recombine a base ramp name with a direction into the name TiTiler expects. */
export const applyColormapDirection = (base: string, reversed: boolean): string => {
    const normalized = getBaseColormapName(base).toLowerCase()
    if (!normalized) return normalized
    return reversed ? `${normalized}_r` : normalized
}

/** Title-cased ramp name for display, e.g. `rd_yl_bu` -> `Rd yl bu`. */
export const formatColormapLabel = (name: string): string => {
    const base = getBaseColormapName(name)
    if (!base) return ''
    return base.charAt(0).toUpperCase() + base.slice(1).replace(/_/g, ' ')
}

/**
 * Read a ramp-name list out of a `/colorMaps` payload. The endpoint's shape
 * varies across TiTiler releases — a flat array of names, or entries carrying
 * the name under `id`/`name` — so accept either rather than pinning the UI to
 * one deployment's version. Returns null when nothing recognizable is present.
 */
export const parseColormapList = (data: unknown): string[] | null => {
    if (data == null || typeof data !== 'object') return null
    const payload = data as ColormapListResponse
    const raw = payload.colorMaps ?? payload.colormaps
    if (!Array.isArray(raw)) return null

    const names = raw
        .map((entry): string | null => {
            if (typeof entry === 'string') return entry
            if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>
                const id = record.id ?? record.name
                if (typeof id === 'string') return id
            }
            return null
        })
        .filter((name): name is string => name != null && name.length > 0)

    return names.length > 0 ? names : null
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

/**
 * Convert TiTiler's index -> RGBA map into ordered CSS color strings. Object
 * keys are numeric strings, whose insertion order is not guaranteed to be the
 * ramp order, so sort numerically before reading them off.
 */
export const colormapResponseToColors = (data: unknown): string[] | null => {
    if (data == null || typeof data !== 'object') return null
    const entries = data as Record<string, unknown>
    const indices = Object.keys(entries)
        .map(Number)
        .filter((index) => !Number.isNaN(index))
        .sort((a, b) => a - b)
    if (indices.length === 0) return null

    const colors = indices
        .map((index) => {
            const channels = entries[String(index)]
            if (!Array.isArray(channels) || channels.length < 3) return null
            const [r, g, b, a = 255] = channels as number[]
            return `rgba(${r}, ${g}, ${b}, ${a / 255})`
        })
        .filter((color): color is string => color != null)

    return colors.length > 0 ? colors : null
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
