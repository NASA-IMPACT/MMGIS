// Resolves a colormap name to the ordered colors a legend paints.
//
// The bundled js-colormaps evaluator is authoritative for every name it holds:
// it is what the client-side raster renderer paints from (see
// MapEngines/Adapters/colormapLUT), and it needs no network. TiTiler's
// /colorMaps/{name} is consulted only for names the bundle lacks — a
// deployment's own custom ramp. A name neither source recognizes, or a lookup
// that fails outright, falls back to the same viridis the renderer paints for
// an unknown colormap, so a legend can never disagree with the map beside it.
//
// Never throws. A caller gets colors or null, never an error to handle.

import {
    evaluate_cmap,
    data as jsColormapData,
} from '../../../external/js-colormaps/js-colormaps.js'
import { fetchColormapColors } from './titilerColormaps'
import {
    findColormapKey,
    getBaseColormapName,
    isReversedColormap,
} from './colormapNaming'

// Matches TiTiler's own granularity, so a bundled ramp and a fetched one
// produce gradients of the same fidelity.
const SAMPLES = 256
const FALLBACK_COLORMAP = 'viridis'

const findLocalKey = (name: string | null | undefined): string | null =>
    findColormapKey(name, Object.keys(jsColormapData))

// Always samples forward; a reversed name reverses the resulting array rather
// than passing `reverse: true` into evaluate_cmap. At this granularity
// `1 - i/n` and `(n-i)/n` do not always land on the same float, which would
// make the reversed ramp an approximation of the forward one rather than its
// exact mirror.
const sampleLocal = (key: string): string[] => {
    const colors: string[] = []
    for (let i = 0; i < SAMPLES; i++) {
        const [r, g, b] = evaluate_cmap(i / (SAMPLES - 1), key, false)
        colors.push(`rgb(${r}, ${g}, ${b})`)
    }
    return colors
}

export const resolveColormapColors = async (
    name: string | null | undefined,
    titilerUrl?: string | null
): Promise<string[] | null> => {
    if (!name) return null
    const reversed = isReversedColormap(name)

    const localKey = findLocalKey(name)
    if (localKey) {
        const colors = sampleLocal(localKey)
        return reversed ? colors.reverse() : colors
    }

    let fetched: string[] | null = null
    try {
        fetched = await fetchColormapColors(
            getBaseColormapName(name).toLowerCase(),
            titilerUrl
        )
    } catch (err) {
        // fetchColormapColors swallows its own failures; this guards the
        // contract against a dependency (real or mocked) that rejects instead.
        console.warn('resolveColormapColors: colormap lookup failed', err)
        fetched = null
    }
    if (fetched) return reversed ? [...fetched].reverse() : fetched

    const fallbackKey = findLocalKey(FALLBACK_COLORMAP)
    return fallbackKey ? sampleLocal(fallbackKey) : null
}
