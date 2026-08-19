// Resolves a colormap name to ordered CSS colors for legend rendering.
// The bundled js-colormaps evaluator is authoritative for every name it
// knows — it is what the client-side deckRaster renderer paints from, and
// it needs no network. TiTiler's /colorMaps/{name} is consulted only for
// names the bundle lacks (server-defined custom ramps); a failure there
// resolves null so the caller can degrade, never throw.
import {
    evaluate_cmap,
    data as jsColormapData,
} from '../../../../external/js-colormaps/js-colormaps.js'
import { fetchColormapColors } from './colormapCache'
import { getBaseColormapName, isReversedColormap } from './colormaps'

const LOCAL_SAMPLES = 32

const findLocalKey = (name: string | null | undefined): string | null => {
    const base = getBaseColormapName(name).toLowerCase()
    if (!base) return null
    return (
        Object.keys(jsColormapData).find((k) => k.toLowerCase() === base) ??
        null
    )
}

export const hasLocalColormap = (name: string | null | undefined): boolean =>
    findLocalKey(name) !== null

const localColormapColors = (key: string, reversed: boolean): string[] => {
    const colors: string[] = []
    for (let i = 0; i < LOCAL_SAMPLES; i++) {
        const [r, g, b] = evaluate_cmap(i / (LOCAL_SAMPLES - 1), key, reversed)
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
    if (localKey) return localColormapColors(localKey, reversed)
    const fetched = await fetchColormapColors(
        getBaseColormapName(name).toLowerCase(),
        titilerUrl,
    )
    if (!fetched) return null
    return reversed ? [...fetched].reverse() : fetched
}
