// The standard colour ramps bundled with the app (matplotlib, cmocean and the
// like), in the shared 256-colour RGBA format.
//
// These are the ramps the app can paint with no tiling service to ask. Each
// is decoded from the bundle on first use and kept, as is its reversed (`_r`)
// form, which is the forward table mirrored. Names match case-insensitively
// and as the tiling service spells them; a `_r` suffix asks for the reversed
// ramp. Tables handed out are shared: callers read them and never write.
//
// A deployment's own ramps are not here; they exist only on its tiling service
// (see titilerColormaps).

import { STANDARD_COLORMAPS } from '../../../external/colormaps/standardColormaps.js'
import {
    ColormapTable,
    colormapTableToCss,
    decodeColormapTable,
    reverseColormapTable,
    sampleColormapTable,
} from './colormapTable'
import { findColormapKey, isReversedColormap } from './colormapNaming'

const BUNDLE: Record<string, string> = STANDARD_COLORMAPS

/** Every bundled ramp's name, forward only, as the tiling service spells it. */
export const STANDARD_COLORMAP_NAMES: string[] = Object.keys(BUNDLE)

/** What a ramp that is not bundled paints as, wherever a ramp must be painted. */
export const FALLBACK_COLORMAP = 'viridis'

const tables = new Map<string, ColormapTable>()

/**
 * The bundled name for `name` (any case, `_r` ignored), or null when the
 * bundle does not hold that ramp.
 */
export const findStandardColormap = (
    name: string | null | undefined
): string | null => findColormapKey(name, STANDARD_COLORMAP_NAMES)

/**
 * The bundled table for `name`, reversed when the name ends in `_r` or
 * `reverse` is set (both together cancel out), or null when the ramp is not
 * bundled.
 */
export const getStandardColormapTable = (
    name: string | null | undefined,
    reverse = false
): ColormapTable | null => {
    const key = findStandardColormap(name)
    if (!key) return null
    const reversed = isReversedColormap(name) !== Boolean(reverse)
    const cacheKey = reversed ? `${key}_r` : key
    let table = tables.get(cacheKey)
    if (!table) {
        let forward = tables.get(key)
        if (!forward) {
            forward = decodeColormapTable(key, BUNDLE[key])
            tables.set(key, forward)
        }
        table = reversed ? reverseColormapTable(forward) : forward
        tables.set(cacheKey, table)
    }
    return table
}

/** The bundled ramp for `name`, or the fallback ramp when it is not bundled. */
export const getStandardColormapTableOrFallback = (
    name: string | null | undefined,
    reverse = false
): ColormapTable =>
    getStandardColormapTable(name, reverse) ??
    getStandardColormapTable(FALLBACK_COLORMAP)

/** All 256 colours of a bundled ramp as CSS colours, or null when not bundled. */
export const getStandardColormapCss = (
    name: string | null | undefined,
    reverse = false
): string[] | null => {
    const table = getStandardColormapTable(name, reverse)
    return table ? colormapTableToCss(table) : null
}

const warnedUnknown = new Set<string>()

/**
 * The `[r, g, b]` a bundled ramp assigns to `x`, a position from 0 to 1, for
 * renderers that colour one pixel at a time. An unknown ramp paints as the
 * fallback, with one warning per name rather than one per pixel.
 */
export const sampleStandardColormap = (
    x: number,
    name: string | null | undefined,
    reverse = false
): [number, number, number] => {
    let table = getStandardColormapTable(name, reverse)
    if (!table) {
        if (!warnedUnknown.has(String(name))) {
            warnedUnknown.add(String(name))
            console.warn(
                `Colormap "${name}" is not bundled; painting ${FALLBACK_COLORMAP} instead.`
            )
        }
        table = getStandardColormapTable(FALLBACK_COLORMAP)
    }
    const [r, g, b] = sampleColormapTable(table, x)
    return [r, g, b]
}
