// What a tiling service says about its colormaps: the ramps it lists at
// `/colorMaps`, and each ramp's definition at `/colorMaps/{name}`.
//
// Each ramp response is read into the shared 256-colour RGBA format, so a ramp
// the service serves malformed is reported by name and treated as one that
// did not load. A ramp is fetched under exactly the name asked for: a `_r`
// name fetches the service's own reversed table, which is not always the
// forward one mirrored colour for colour.
//
// Every lookup is cached per service. The in-flight promise is what is cached,
// not just the result, so several layers painting the same ramp cost one
// request between them, and the settled result can also be read synchronously
// (see peekColormapTable) by a renderer that cannot wait.

import { parseColormapList } from './colormapList'
import {
    ColormapTable,
    colormapResponseToTable,
    describeServiceError,
} from './colormapTable'

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

/**
 * One cached lookup. `settled` is undefined while the request is in flight,
 * then holds its answer (null for a failure). A success is kept for the
 * session; a failure only until `expiresAt`.
 */
type CachedLookup<T> = {
    pending: Promise<T | null>
    settled: T | null | undefined
    expiresAt: number
}

const cache = new Map<string, CachedLookup<unknown>>()

/** Trailing-slash-normalized base, or null when no service was supplied. */
const resolveBase = (titilerUrl?: string | null): string | null =>
    titilerUrl ? titilerUrl.replace(/\/$/, '') : null

/** The name a ramp is requested under: trimmed and lowercased, `_r` kept. */
const requestName = (name: string | null | undefined): string =>
    (name || '').trim().toLowerCase()

const liveEntry = <T>(key: string): CachedLookup<T> | null => {
    const entry = cache.get(key) as CachedLookup<T> | undefined
    return entry && entry.expiresAt > Date.now() ? entry : null
}

/**
 * Fetches `url` once per key and reads its JSON with `read`. Never rejects:
 * a request that fails, times out or answers with something `read` refuses
 * resolves to null, with a warning naming `what`.
 */
const cachedLookup = <T>(
    key: string,
    url: string,
    what: string,
    read: (data: unknown) => T | null
): Promise<T | null> => {
    const cached = liveEntry<T>(key)
    if (cached) return cached.pending

    const pending = (async (): Promise<T | null> => {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(COLORMAP_FETCH_TIMEOUT_MS),
            })
            if (!response.ok) {
                const detail = describeServiceError(
                    await response.json().catch(() => null)
                )
                throw new Error(
                    `Failed to fetch ${what}: ${response.status}${
                        detail ? ` ${detail}` : ''
                    }`
                )
            }
            return read(await response.json())
        } catch (err) {
            console.warn(`Failed to fetch ${what}:`, err)
            return null
        }
    })()

    const entry: CachedLookup<T> = {
        pending,
        settled: undefined,
        expiresAt: Infinity,
    }
    cache.set(key, entry as CachedLookup<unknown>)
    // Dated once the answer is in, on the entry itself rather than through a
    // timer: an expired entry is simply replaced by the next lookup.
    void pending.then((value) => {
        entry.settled = value
        if (value == null) entry.expiresAt = Date.now() + FAILURE_TTL_MS
    })
    return pending
}

// Keyed per service so two deployments serving different definitions of the
// same ramp name do not collide.
const tableKey = (baseUrl: string, name: string): string =>
    `table|${baseUrl}|${name}`

/**
 * One ramp's table as the service defines it, or null when there is no service
 * to ask, it cannot answer, or its answer is not a 256-colour table. A `_r`
 * name asks for the service's reversed ramp. Never rejects: a ramp that will
 * not load leaves the caller to fall back, not to handle an error.
 */
export const fetchColormapTable = (
    name: string,
    titilerUrl?: string | null
): Promise<ColormapTable | null> => {
    const baseUrl = resolveBase(titilerUrl)
    const rampName = requestName(name)
    if (baseUrl == null || !rampName) return Promise.resolve(null)
    return cachedLookup(
        tableKey(baseUrl, rampName),
        `${baseUrl}/colorMaps/${encodeURIComponent(rampName)}`,
        `colormap ${rampName}`,
        (data) => colormapResponseToTable(rampName, data)
    )
}

/**
 * What fetchColormapTable would answer right now, without waiting: the table
 * once it has loaded, null once it has failed (or when there is no service to
 * ask), and undefined when it has not been asked for or is still in flight.
 * Never starts a request.
 */
export const peekColormapTable = (
    name: string,
    titilerUrl?: string | null
): ColormapTable | null | undefined => {
    const baseUrl = resolveBase(titilerUrl)
    const rampName = requestName(name)
    if (baseUrl == null || !rampName) return null
    return liveEntry<ColormapTable>(tableKey(baseUrl, rampName))?.settled
}

/**
 * Every ramp name the service lists, `_r` variants included, as it spells
 * them; or null when there is no service, it cannot answer, or its answer
 * lists nothing recognizable.
 */
export const fetchColormapList = (
    titilerUrl?: string | null
): Promise<string[] | null> => {
    const baseUrl = resolveBase(titilerUrl)
    if (baseUrl == null) return Promise.resolve(null)
    return cachedLookup(
        `list|${baseUrl}`,
        `${baseUrl}/colorMaps`,
        'colormap list',
        parseColormapList
    )
}

/** Test seam — clears memoized lookups so specs don't leak state across cases. */
export const clearColormapCache = (): void => {
    cache.clear()
}
