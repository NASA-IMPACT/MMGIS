import { coordinatesEndpointFor, newestRuns, leadRangeOf } from '../lib/utils/forecast'

export type RunsAndLeads = { runs: string[]; leadRange: [number, number] | null }

type Source = { url?: string; runsUrl?: string; leadUrl?: string }

const cache = new Map<string, Promise<RunsAndLeads>>()

const readData = async (endpoint: string | null): Promise<unknown> => {
    if (!endpoint) return null
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return ((await response.json()) as { data?: unknown })?.data ?? null
}

// One read per layer per session: runs appear twice a day, and the panel
// refreshes far more often than that.
export const fetchForecastRuns = (
    layerId: string,
    source: Source,
    maxRuns: number,
): Promise<RunsAndLeads> => {
    const key = `${layerId}:${maxRuns}`
    const hit = cache.get(key)
    if (hit) return hit
    const url = source.url ?? ''
    const pending = Promise.all([
        readData(source.runsUrl ?? coordinatesEndpointFor(url, 'reference_time')),
        readData(source.leadUrl ?? coordinatesEndpointFor(url, 'lead')),
    ]).then(([runs, leads]) => ({
        runs: newestRuns(runs, maxRuns),
        leadRange: leadRangeOf(leads),
    }))
    cache.set(key, pending)
    pending.catch(() => cache.delete(key))
    return pending
}

export const clearForecastRunsCache = (): void => cache.clear()
