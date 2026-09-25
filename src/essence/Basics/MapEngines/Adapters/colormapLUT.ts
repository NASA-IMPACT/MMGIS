// Generates colormap lookup tables that match TiTiler's colormap_name output,
// reusing MMGIS's existing js-colormaps evaluator so the client-side render
// and the TiTiler render agree (including matplotlib `_r` reversed variants).
import { evaluate_cmap } from '../../../../external/js-colormaps/js-colormaps.js'
import { resolveLocalColormap } from '../../Colormaps/localColormaps'

const FALLBACK = 'viridis'

/**
 * The ramp to paint for a configured name, falling back rather than failing
 * since a layer still has to render something. Ask `hasLocalColormap` when you
 * need to know whether a ramp exists rather than what stands in for it.
 */
export function normalizeColormapName(name: string): { name: string; reverse: boolean } {
    return resolveLocalColormap(name) ?? { name: FALLBACK, reverse: false }
}

export function buildColormapLUT(colormapName: string): Uint8ClampedArray {
    const { name, reverse } = normalizeColormapName(colormapName)
    const lut = new Uint8ClampedArray(256 * 4)
    for (let i = 0; i < 256; i++) {
        const [r, g, b] = evaluate_cmap(i / 255, name, reverse)
        lut[i * 4] = r
        lut[i * 4 + 1] = g
        lut[i * 4 + 2] = b
        lut[i * 4 + 3] = 255
    }
    return lut
}
