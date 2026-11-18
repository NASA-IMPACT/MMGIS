// Resolves a colormap name to the ordered colors a legend paints.
//
// The bundled standard ramps are authoritative for every name they hold: they
// are what the client-side raster renderer paints from (see
// MapEngines/Adapters/colormapLUT), and they need no network. TiTiler's
// /colorMaps/{name} is consulted only for names the bundle lacks — a
// deployment's own custom ramp. A name neither source recognizes, or a lookup
// that fails outright, falls back to the same viridis the renderer paints for
// an unknown colormap, so a legend can never disagree with the map beside it.
//
// Never throws. A caller gets colors or null, never an error to handle.

import { fetchColormapColors } from './titilerColormaps'
import { isReversedColormap } from './colormapNaming'
import {
    FALLBACK_COLORMAP,
    getStandardColormapCss,
} from './standardColormaps'

export const resolveColormapColors = async (
    name: string | null | undefined,
    titilerUrl?: string | null
): Promise<string[] | null> => {
    if (!name) return null

    // Reversed exactly: a `_r` name reads the forward table mirrored, colour
    // for colour.
    const local = getStandardColormapCss(name)
    if (local) return local

    let fetched: string[] | null = null
    try {
        // Passed as written: fetchColormapColors is where a ramp name is
        // normalised, because it is what builds the URL from it.
        fetched = await fetchColormapColors(name, titilerUrl)
    } catch (err) {
        // fetchColormapColors swallows its own failures; this guards the
        // contract against a dependency (real or mocked) that rejects instead.
        console.warn('resolveColormapColors: colormap lookup failed', err)
        fetched = null
    }
    if (fetched) return isReversedColormap(name) ? [...fetched].reverse() : fetched

    return getStandardColormapCss(FALLBACK_COLORMAP)
}
