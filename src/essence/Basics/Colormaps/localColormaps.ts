// The ramps MMGIS can colour without a tile server.
//
// Anything that renders a ramp — the GPU lookup table, a legend, a picker
// swatch — resolves it here, so a preview cannot advertise colours the render
// does not produce. A tiling service may define ramps this does not; those
// stay the service's to resolve, which is what `hasLocalColormap` is for.
import {
    evaluate_cmap,
    data as colormapData,
} from '../../../external/js-colormaps/js-colormaps.js'

/** Chosen to match the GPU lookup table and a tiling service's payload. */
const SAMPLES = 256

const REVERSED_SUFFIX = /_r$/i

type ColormapEntry = { interpolate: boolean; colors: number[][] }

const entries = colormapData as Record<string, ColormapEntry>

/**
 * Recovers the evaluator's own spelling and the `_r` direction suffix. Null
 * rather than a fallback, so callers can tell an unknown ramp from a known one.
 */
export function resolveLocalColormap(
    name: string | null | undefined
): { name: string; reverse: boolean } | null {
    const raw = (name || '').trim()
    if (!raw) return null
    const reverse = REVERSED_SUFFIX.test(raw)
    const base = reverse ? raw.slice(0, -2) : raw
    const match = Object.keys(entries).find(
        (key) => key.toLowerCase() === base.toLowerCase()
    )
    return match ? { name: match, reverse } : null
}

/** Whether this can colour the ramp, `_r` variants included. */
export function hasLocalColormap(name: string | null | undefined): boolean {
    return resolveLocalColormap(name) != null
}

/**
 * Lowercased to match how a tiling service names ramps, which the label and
 * apply paths assume. The evaluator's names stay distinct when folded.
 */
export function listLocalColormapNames(): string[] {
    return Object.keys(entries)
        .map((name) => name.toLowerCase())
        .sort((a, b) => a.localeCompare(b))
}

/**
 * One ramp's ordered CSS colours, sampled as the GPU samples it so a preview
 * matches the pixels it stands for.
 *
 * Qualitative ramps are sampled uniformly too: `evaluate_cmap` buckets them
 * itself, so this reproduces their hard bands. Emitting one at its palette
 * length instead would let a gradient blend smoothly between its colours.
 */
export function getLocalColormapColors(
    name: string | null | undefined
): string[] | null {
    const resolved = resolveLocalColormap(name)
    if (resolved == null) return null

    const colors: string[] = []
    for (let i = 0; i < SAMPLES; i++) {
        const [r, g, b] = evaluate_cmap(
            i / (SAMPLES - 1),
            resolved.name,
            resolved.reverse
        )
        colors.push(`rgba(${r}, ${g}, ${b}, 1)`)
    }
    return colors
}

let table: Record<string, string[]> | null = null

/**
 * Every ramp's colours, keyed by name, for handing to a UI that cannot import
 * this module. Memoized — derived from a constant and asked for per layer.
 */
export function buildLocalColormapTable(): Record<string, string[]> {
    if (table != null) return table
    const built: Record<string, string[]> = {}
    listLocalColormapNames().forEach((name) => {
        const colors = getLocalColormapColors(name)
        if (colors != null) built[name] = colors
    })
    table = built
    return table
}
