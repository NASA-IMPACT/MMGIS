// Process-wide cache for resolved ramp colors.
//
// A ramp picker lists ~100 ramps, each needing its own `/colorMaps/{name}`
// lookup to draw a swatch, and the same ramps are re-requested every time a
// dropdown reopens. Caching the in-flight promise (not just the result)
// collapses concurrent requests for the same ramp into one, so scrolling the
// list quickly or opening two layers' pickers costs a single fetch per ramp.

import { colormapResponseToColors } from './colormaps'

const cache = new Map<string, Promise<string[] | null>>()

/**
 * Where ramps come from when no tiling service can supply them: the host's
 * own ramps, so a picker lists and draws what the host paints with.
 */
export type ColormapFallback = {
    /** Ramp names, forward and `_r`, or null when there are none. */
    list: () => Promise<string[] | null>
    /** One forward ramp's colours, or null when the host does not hold it. */
    colors: (name: string) => Promise<string[] | null>
}

let fallback: ColormapFallback | null = null

/** Installs the host's ramps; null removes them. */
export const setColormapFallback = (source: ColormapFallback | null): void => {
    fallback = source
    cache.clear()
}

export const getColormapFallback = (): ColormapFallback | null => fallback

/** Trailing-slash-normalized base, or null when no service was supplied. */
export const resolveTiTilerBase = (titilerUrl?: string | null): string | null =>
    titilerUrl ? titilerUrl.replace(/\/$/, '') : null

/**
 * Resolve one ramp's ordered colors. Names are cached per base URL so two
 * TiTiler deployments serving different definitions of the same ramp name
 * don't collide. With no service, or one that cannot answer, the colors come
 * from the installed fallback. Failures resolve to null rather than
 * rejecting — a swatch that can't load should render blank, not tear down the
 * list.
 */
export const fetchColormapColors = (
    name: string,
    titilerUrl?: string | null,
): Promise<string[] | null> => {
    const baseUrl = resolveTiTilerBase(titilerUrl)
    if (!name || (baseUrl == null && fallback == null)) return Promise.resolve(null)

    const key = `${baseUrl ?? ''}|${name}`
    const cached = cache.get(key)
    if (cached) return cached

    const fromService = async (): Promise<string[] | null> => {
        if (baseUrl == null) return null
        try {
            const response = await fetch(`${baseUrl}/colorMaps/${encodeURIComponent(name)}`)
            if (!response.ok) {
                throw new Error(`Failed to fetch colormap ${name}: ${response.status}`)
            }
            return colormapResponseToColors(await response.json())
        } catch (err) {
            console.warn('Failed to fetch colormap colors:', err)
            return null
        }
    }
    const pending = (async (): Promise<string[] | null> =>
        (await fromService()) ??
        (await fallback?.colors(name).catch(() => null)) ??
        null)()

    cache.set(key, pending)
    // Only a resolved ramp is worth remembering. Evicting afterwards — rather
    // than from inside the failure path — covers a request that fails before
    // it was ever cached, and leaves a later open free to retry. The identity
    // check keeps a retry already in flight from being evicted.
    void pending.then((colors) => {
        if (colors == null && cache.get(key) === pending) cache.delete(key)
    })
    return pending
}

/** Test seam — clears memoized ramps so specs don't leak state across cases. */
export const clearColormapCache = (): void => {
    cache.clear()
}
