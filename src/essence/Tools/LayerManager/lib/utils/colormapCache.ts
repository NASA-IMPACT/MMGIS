// Process-wide cache for resolved ramp colors.
//
// A ramp picker lists ~100 ramps, each needing its own `/colorMaps/{name}`
// lookup to draw a swatch, and the same ramps are re-requested every time a
// dropdown reopens. Caching the in-flight promise (not just the result)
// collapses concurrent requests for the same ramp into one, so scrolling the
// list quickly or opening two layers' pickers costs a single fetch per ramp.

import { colormapResponseToColors } from './colormaps'

const cache = new Map<string, Promise<string[] | null>>()

/** Trailing-slash-normalized base, or null when no service was supplied. */
export const resolveTiTilerBase = (titilerUrl?: string | null): string | null =>
    titilerUrl ? titilerUrl.replace(/\/$/, '') : null

/**
 * Resolve one ramp's ordered colors. Names are cached per base URL so two
 * TiTiler deployments serving different definitions of the same ramp name
 * don't collide. Failures resolve to null rather than rejecting — a swatch
 * that can't load should render blank, not tear down the list.
 *
 * `localColormaps` holds ramps the caller can already colour. It takes
 * precedence: those need no network, and resolving them here keeps a swatch
 * agreeing with the renderer they came from.
 */
export const fetchColormapColors = (
    name: string,
    titilerUrl?: string | null,
    localColormaps?: Record<string, string[]> | null,
): Promise<string[] | null> => {
    if (!name) return Promise.resolve(null)

    const local = localColormaps?.[name]
    if (local) return Promise.resolve(local)

    const baseUrl = resolveTiTilerBase(titilerUrl)
    if (baseUrl == null) return Promise.resolve(null)

    const key = `${baseUrl}|${name}`
    const cached = cache.get(key)
    if (cached) return cached

    const pending = (async (): Promise<string[] | null> => {
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
    })()

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
