// The ramps MMGIS can colour without a tile server.
//
// One evaluator answers two questions that used to have separate sources: what
// the GPU paints (buildColormapLUT, via normalizeColormapName) and what a
// legend swatch or ramp picker draws. Splitting those risked a swatch that
// advertised colours the render never produced, so both read from here.
//
// TiTiler's `/colorMaps` still knows ramps this evaluator does not — a
// deployment can register its own. Those stay the tile server's to serve;
// `hasLocalColormap` reports false for them so callers can tell the difference
// rather than silently painting the fallback ramp.
import {
    evaluate_cmap,
    data as colormapData,
} from '../../../external/js-colormaps/js-colormaps.js'

/** Samples per interpolated ramp, matching the length TiTiler's payload carries. */
const INTERPOLATED_SAMPLES = 256

const REVERSED_SUFFIX = /_r$/i

type ColormapEntry = { interpolate: boolean; colors: number[][] }

const entries = colormapData as Record<string, ColormapEntry>

/**
 * Case-insensitively recover the evaluator's own spelling of a ramp, splitting
 * off the `_r` direction suffix. Returns null — never a fallback — when the
 * evaluator does not define the ramp, so callers can distinguish "unknown" from
 * "known and forward".
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

/** Whether this evaluator can colour the ramp, `_r` variants included. */
export function hasLocalColormap(name: string | null | undefined): boolean {
    return resolveLocalColormap(name) != null
}

/**
 * Every ramp the evaluator defines, alphabetized, forward directions only.
 *
 * Lowercased because that is how a tiling service names its ramps, and the
 * label and apply paths downstream already assume it. Emitting the evaluator's
 * own mixed casing would render "RdBu" where the service path renders "Rdbu".
 * The evaluator's 107 names stay distinct when lowercased.
 */
export function listLocalColormapNames(): string[] {
    return Object.keys(entries)
        .map((name) => name.toLowerCase())
        .sort((a, b) => a.localeCompare(b))
}

/**
 * One ramp's ordered CSS colours, in the shape the TiTiler fetch used to
 * return so gradient rendering is unchanged.
 *
 * A qualitative ramp emits exactly its own palette: `evaluate_cmap` buckets
 * such a ramp into `colors.length` bands, so sampling it at the interpolated
 * resolution would repeat entries at uneven widths and paint the wrong bands.
 * Each band is sampled at its midpoint to land inside it.
 */
export function getLocalColormapColors(
    name: string | null | undefined
): string[] | null {
    const resolved = resolveLocalColormap(name)
    if (resolved == null) return null

    const entry = entries[resolved.name]
    const count = entry.interpolate ? INTERPOLATED_SAMPLES : entry.colors.length
    const positionOf = entry.interpolate
        ? (i: number) => i / (count - 1)
        : (i: number) => (i + 0.5) / count

    const colors: string[] = []
    for (let i = 0; i < count; i++) {
        const [r, g, b] = evaluate_cmap(
            positionOf(i),
            resolved.name,
            resolved.reverse
        )
        colors.push(`rgba(${r}, ${g}, ${b}, 1)`)
    }
    return colors
}

let table: Record<string, string[]> | null = null

/**
 * Every local ramp's colours, keyed by name — the payload handed across the
 * plugin boundary so the UI can draw swatches without reaching into core or
 * the network. Memoized: it is derived from a constant and several layers'
 * legends ask for it.
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
