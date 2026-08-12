import { useEffect, useState } from 'react'
import { resolveTiTilerBase } from '../utils/colormapCache'
import { parseColormapList } from '../utils/colormaps'

type Result = {
    colormaps: string[] | null
    loading: boolean
    error: Error | null
}

/**
 * Ramp names the tiling service reports, sorted with each ramp's reversed
 * variant directly after its forward form. Resolves to null whenever no list
 * can be obtained — no service supplied, or the request failed — which callers
 * surface as "ramps unavailable" rather than an empty list.
 */
export const useAvailableColormaps = (titilerUrl: string | null = null): Result => {
    const baseUrl = resolveTiTilerBase(titilerUrl)
    const [colormaps, setColormaps] = useState<string[] | null>(null)
    // A reachable service is presumed to be loading from the first render,
    // before the effect has had a chance to start the request. Without that,
    // the empty initial list is indistinguishable from "no ramps exist" and
    // callers flash an unavailable state on every mount.
    const [loading, setLoading] = useState(() => baseUrl != null)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        if (baseUrl == null) {
            setColormaps(null)
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
                    setColormaps(null)
                    return
                }
                const sorted = [...colormapList].sort((a, b) => {
                    const aBase = a.replace(/_r$/, '')
                    const bBase = b.replace(/_r$/, '')
                    if (aBase !== bBase) return aBase.localeCompare(bBase)
                    return a.endsWith('_r') ? 1 : -1
                })
                setColormaps(sorted)
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to fetch available colormaps:', err)
                    setError(err as Error)
                    setColormaps(null)
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
