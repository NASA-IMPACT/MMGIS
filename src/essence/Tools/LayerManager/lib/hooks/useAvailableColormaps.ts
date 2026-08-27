import { useEffect, useState } from 'react'
import { resolveTiTilerBase } from '../utils/colormapCache'
import { parseColormapList } from '../utils/colormaps'

type Result = {
    colormaps: string[] | null
    loading: boolean
    error: Error | null
}

/** Forward ramps first, each followed immediately by its reversed variant. */
const byRampThenDirection = (a: string, b: string): number => {
    const aBase = a.replace(/_r$/, '')
    const bBase = b.replace(/_r$/, '')
    if (aBase !== bBase) return aBase.localeCompare(bBase)
    return a.endsWith('_r') ? 1 : -1
}

/**
 * The ramps a layer may be offered, sorted with each ramp's reversed variant
 * directly after its forward form. Resolves to null when no list can be
 * obtained at all, which callers surface as "ramps unavailable" rather than an
 * empty list.
 *
 * `localColormaps` names the ramps the app can paint itself, supplied as data
 * by core. `deckRaster` says the layer is painted by that client-side renderer
 * — and then those ramps are the whole list, because a service's extra ramps
 * would be offered but silently render as the fallback. A server-rendered
 * layer gets both, since its tile server can paint whatever it registers.
 *
 * Whenever local ramps are known they are also the floor: an unreachable
 * service degrades the list rather than emptying it.
 */
export const useAvailableColormaps = (
    titilerUrl: string | null = null,
    localColormaps: string[] | null = null,
    deckRaster = false,
): Result => {
    const local = localColormaps?.length ? localColormaps : null
    // A locally-rendered layer never consults the service, so there is no base
    // URL to resolve and nothing to wait for.
    const baseUrl = local && deckRaster ? null : resolveTiTilerBase(titilerUrl)
    const localSorted = local ? [...local].sort(byRampThenDirection) : null
    const [colormaps, setColormaps] = useState<string[] | null>(localSorted)
    // A reachable service is presumed to be loading from the first render,
    // before the effect has had a chance to start the request. Without that,
    // the empty initial list is indistinguishable from "no ramps exist" and
    // callers flash an unavailable state on every mount.
    const [loading, setLoading] = useState(() => baseUrl != null)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        if (baseUrl == null) {
            setColormaps(localSorted)
            setLoading(false)
            setError(null)
            return
        }
        let cancelled = false
        const fetchColormaps = async () => {
            setLoading(true)
            setError(null)
            try {
                const response = await fetch(`${baseUrl}/colorMaps`)
                if (!response.ok) throw new Error(`Failed to fetch colormaps: ${response.status}`)
                const data = await response.json()
                if (cancelled) return
                const colormapList = parseColormapList(data)
                if (colormapList == null) {
                    setColormaps(localSorted)
                    return
                }
                const merged = local
                    ? [...new Set([...local, ...colormapList])]
                    : [...colormapList]
                setColormaps(merged.sort(byRampThenDirection))
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to fetch available colormaps:', err)
                    setError(err as Error)
                    setColormaps(localSorted)
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        fetchColormaps()
        return () => {
            cancelled = true
        }
    }, [baseUrl])

    return { colormaps, loading, error }
}
