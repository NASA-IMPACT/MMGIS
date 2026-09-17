// The tiling service's colormap definitions, fetched once per ramp.
//
// Only ramps the bundled js-colormaps evaluator does not hold come through
// here — a deployment's own custom ramp. The in-flight promise is what is
// cached, not just the result, so several layers painting the same custom ramp
// cost one request between them.

import { getBaseColormapName } from './colormapNaming'

const cache = new Map<string, Promise<string[] | null>>()

/** Trailing-slash-normalized base, or null when no service was supplied. */
const resolveBase = (titilerUrl?: string | null): string | null =>
    titilerUrl ? titilerUrl.replace(/\/$/, '') : null

/**
 * Convert TiTiler's index -> RGBA map into ordered CSS color strings. Object
 * keys are numeric strings, whose insertion order is not guaranteed to be the
 * ramp order, so sort numerically before reading them off.
 */
export const colormapResponseToColors = (data: unknown): string[] | null => {
    if (data == null || typeof data !== 'object') return null
    const entries = data as Record<string, unknown>
    const indices = Object.keys(entries)
        .map(Number)
        .filter((index) => !Number.isNaN(index))
        .sort((a, b) => a - b)
    if (indices.length === 0) return null

    const colors = indices
        .map((index) => {
            const channels = entries[String(index)]
            if (!Array.isArray(channels) || channels.length < 3) return null
            const [r, g, b, a = 255] = channels as number[]
            return `rgba(${r}, ${g}, ${b}, ${a / 255})`
        })
        .filter((color): color is string => color != null)

    return colors.length > 0 ? colors : null
}

/**
 * One ramp's ordered colors as the service defines them, or null when there is
 * no service to ask or it cannot answer. Never rejects: a ramp that will not
 * load leaves the caller to fall back, not to handle an error.
 */
export const fetchColormapColors = (
    name: string,
    titilerUrl?: string | null
): Promise<string[] | null> => {
    const baseUrl = resolveBase(titilerUrl)
    const rampName = getBaseColormapName(name).toLowerCase()
    if (baseUrl == null || !rampName) return Promise.resolve(null)

    // Keyed per service so two deployments serving different definitions of
    // the same ramp name do not collide.
    const key = `${baseUrl}|${rampName}`
    const cached = cache.get(key)
    if (cached) return cached

    const pending = (async (): Promise<string[] | null> => {
        try {
            const response = await fetch(
                `${baseUrl}/colorMaps/${encodeURIComponent(rampName)}`
            )
            if (!response.ok)
                throw new Error(
                    `Failed to fetch colormap ${rampName}: ${response.status}`
                )
            return colormapResponseToColors(await response.json())
        } catch (err) {
            console.warn('Failed to fetch colormap colors:', err)
            return null
        }
    })()

    cache.set(key, pending)
    // Only a resolved ramp is worth remembering. The identity check keeps a
    // retry already in flight from being evicted by the failure it replaced.
    void pending.then((colors) => {
        if (colors == null && cache.get(key) === pending) cache.delete(key)
    })
    return pending
}

/** Test seam — clears memoized ramps so specs don't leak state across cases. */
export const clearColormapCache = (): void => {
    cache.clear()
}
