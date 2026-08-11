// Generates colormap lookup tables that match TiTiler's colormap_name output,
// reusing MMGIS's existing js-colormaps evaluator so the client-side render
// and the TiTiler render agree (including matplotlib `_r` reversed variants).
import { evaluate_cmap, data as colormapData } from '../../../../external/js-colormaps/js-colormaps.js'

const FALLBACK = 'viridis'

export function normalizeColormapName(name: string): { name: string; reverse: boolean } {
    const raw = (name || '').trim()
    const reverse = /_r$/i.test(raw)
    const base = reverse ? raw.slice(0, -2) : raw
    const keys = Object.keys(colormapData)
    const match = keys.find((k) => k.toLowerCase() === base.toLowerCase())
    return { name: match || FALLBACK, reverse: match ? reverse : false }
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
