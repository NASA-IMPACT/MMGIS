// Resolves a colormap name to ordered CSS colors for legend rendering.
// The bundled js-colormaps evaluator is authoritative for every name it
// knows — it is what the client-side deckRaster renderer paints from, and
// it needs no network. TiTiler's /colorMaps/{name} is consulted only for
// names the bundle lacks (server-defined custom ramps). A name neither
// source recognizes, or a TiTiler lookup that fails outright, falls back to
// the same viridis ramp deckRaster paints for an unknown colormap (see
// colormapLUT's FALLBACK) — the export must never disagree with what's on
// the map. This function never throws; the renderer's neutral gray ramp is
// the last-ditch backstop for a genuinely missing/null colors list.
import {
    evaluate_cmap,
    data as jsColormapData,
} from '../../../../external/js-colormaps/js-colormaps.js'
import { fetchColormapColors } from './colormapCache'
import { getBaseColormapName, isReversedColormap, findColormapKey } from './colormaps'

const LOCAL_SAMPLES = 256
const FALLBACK_COLORMAP = 'viridis'

const findLocalKey = (name: string | null | undefined): string | null =>
    findColormapKey(name, Object.keys(jsColormapData))

// Always samples forward; a reversed name reverses the resulting array
// rather than passing `reverse: true` into evaluate_cmap. At LOCAL_SAMPLES
// this granular, `1 - i/n` and `(n-i)/n` don't always land on the same
// float, which would otherwise make the reversed ramp an approximation of
// the forward one instead of its exact mirror.
const localColormapColors = (key: string): string[] => {
    const colors: string[] = []
    for (let i = 0; i < LOCAL_SAMPLES; i++) {
        const [r, g, b] = evaluate_cmap(i / (LOCAL_SAMPLES - 1), key, false)
        colors.push(`rgb(${r}, ${g}, ${b})`)
    }
    return colors
}

export const resolveColormapColors = async (
    name: string | null | undefined,
    titilerUrl?: string | null,
): Promise<string[] | null> => {
    if (!name) return null
    const reversed = isReversedColormap(name)
    const localKey = findLocalKey(name)
    if (localKey) {
        const colors = localColormapColors(localKey)
        return reversed ? [...colors].reverse() : colors
    }

    let fetched: string[] | null = null
    try {
        fetched = await fetchColormapColors(
            getBaseColormapName(name).toLowerCase(),
            titilerUrl,
        )
    } catch (err) {
        // fetchColormapColors already swallows its own failures; this guards
        // the contract against a dependency (real or mocked) that rejects
        // instead.
        console.warn('resolveColormapColors: TiTiler lookup failed', err)
        fetched = null
    }
    if (fetched) return reversed ? [...fetched].reverse() : fetched

    const fallbackKey = findLocalKey(FALLBACK_COLORMAP)
    return fallbackKey ? localColormapColors(fallbackKey) : null
}
