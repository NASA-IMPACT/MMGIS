// Colormap naming, core-owned.
//
// TiTiler encodes a ramp's direction in its name: `viridis` is the forward
// ramp, `viridis_r` the reversed one. Both the core raster renderer
// (MapEngines/Adapters/colormapLUT) and the legend that has to agree with what
// it painted resolve names through these helpers, so the two can never drift
// apart. Pure string handling — no imports, no host state.

const REVERSED_SUFFIX = /_r$/i

export const isReversedColormap = (name: string | null | undefined): boolean =>
    typeof name === 'string' && REVERSED_SUFFIX.test(name)

export const getBaseColormapName = (name: string | null | undefined): string => {
    if (!name) return ''
    return name.replace(REVERSED_SUFFIX, '')
}

/**
 * Case-insensitively matches a colormap name (optionally `_r`-suffixed)
 * against a set of canonical keys, returning the key's original casing. The
 * bundled js-colormaps evaluator keys its ramps by their published casing
 * (e.g. `RdBu`), so a lowercased comparison is needed either way.
 */
export const findColormapKey = (
    name: string | null | undefined,
    keys: string[],
): string | null => {
    const base = getBaseColormapName(name).toLowerCase()
    if (!base) return null
    return keys.find((k) => k.toLowerCase() === base) ?? null
}
