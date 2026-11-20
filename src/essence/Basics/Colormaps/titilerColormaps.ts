// The tiling service's colormap definitions, fetched once per ramp.
//
// Only ramps the bundled js-colormaps evaluator does not hold come through
// here — a deployment's own custom ramp. The in-flight promise is what is
// cached, not just the result, so several layers painting the same custom ramp
// cost one request between them.

import { getBaseColormapName } from './colormapNaming'

/** An answer that resolved is kept for the session; one that did not is not. */
type CachedAnswer = { answer: Promise<string[] | null>; expiresAt: number }

const cache = new Map<string, CachedAnswer>()

/**
 * How long a failed lookup is remembered. Long enough that an unreachable
 * service is not re-dialled — and every legend re-blocked on it — each time a
 * layer's opacity moves; short enough that a service coming back is picked up
 * without a reload.
 */
const FAILURE_TTL_MS = 60000

/**
 * How long a lookup may take before it counts as failed. While one is pending
 * its entry never expires, and every bulk legend request awaits it, so a
 * service that accepts the connection and never answers would otherwise hold
 * all of them indefinitely.
 */
const COLORMAP_FETCH_TIMEOUT_MS = 5000

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
    if (cached && cached.expiresAt > Date.now()) return cached.answer

    const pending = (async (): Promise<string[] | null> => {
        try {
            const response = await fetch(
                `${baseUrl}/colorMaps/${encodeURIComponent(rampName)}`,
                { signal: AbortSignal.timeout(COLORMAP_FETCH_TIMEOUT_MS) }
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

    const entry: CachedAnswer = { answer: pending, expiresAt: Infinity }
    cache.set(key, entry)
    // Dated once the answer is in, on the entry itself rather than through a
    // timer: an expired entry is simply replaced by the next lookup.
    void pending.then((colors) => {
        if (colors == null) entry.expiresAt = Date.now() + FAILURE_TTL_MS
    })
    return pending
}

/**
 * Read a ramp-name list out of a `/colorMaps` payload. The endpoint's shape
 * varies across TiTiler releases — a flat array of names under `colorMaps`, or
 * entries under `colormaps` carrying the name as `id`/`name` — so either is
 * accepted. Null when nothing recognizable is present.
 */
export const parseColormapList = (data: unknown): string[] | null => {
    if (data == null || typeof data !== 'object') return null
    const payload = data as { colorMaps?: unknown; colormaps?: unknown }
    const raw = payload.colorMaps ?? payload.colormaps
    if (!Array.isArray(raw)) return null

    const names = raw
        .map((entry): string | null => {
            if (typeof entry === 'string') return entry
            if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>
                const id = record.id ?? record.name
                if (typeof id === 'string') return id
            }
            return null
        })
        .filter((name): name is string => name != null && name.length > 0)

    return names.length > 0 ? names : null
}

/** Each service's ramp list, cached the way a ramp is. */
const listCache = new Map<string, CachedAnswer>()

/**
 * The ramp names a service lists, forward and `_r`, or null when there is no
 * service to ask or it cannot answer. Never rejects.
 */
export const fetchColormapNames = (
    titilerUrl?: string | null
): Promise<string[] | null> => {
    const baseUrl = resolveBase(titilerUrl)
    if (baseUrl == null) return Promise.resolve(null)

    const cached = listCache.get(baseUrl)
    if (cached && cached.expiresAt > Date.now()) return cached.answer

    const pending = (async (): Promise<string[] | null> => {
        try {
            const response = await fetch(`${baseUrl}/colorMaps`, {
                signal: AbortSignal.timeout(COLORMAP_FETCH_TIMEOUT_MS),
            })
            if (!response.ok)
                throw new Error(`Failed to list colormaps: ${response.status}`)
            return parseColormapList(await response.json())
        } catch (err) {
            console.warn('Failed to list colormaps:', err)
            return null
        }
    })()

    const entry: CachedAnswer = { answer: pending, expiresAt: Infinity }
    listCache.set(baseUrl, entry)
    void pending.then((names) => {
        if (names == null) entry.expiresAt = Date.now() + FAILURE_TTL_MS
    })
    return pending
}

/** Test seam — clears memoized ramps so specs don't leak state across cases. */
export const clearColormapCache = (): void => {
    cache.clear()
    listCache.clear()
}
