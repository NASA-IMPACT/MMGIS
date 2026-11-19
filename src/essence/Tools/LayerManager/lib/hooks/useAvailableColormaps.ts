import { useEffect, useState } from 'react'
import { getColormapFallback, resolveTiTilerBase } from '../utils/colormapCache'
import { parseColormapList } from '../utils/colormaps'

type Result = {
    colormaps: string[] | null
    loading: boolean
    error: Error | null
}

/** Each ramp's reversed variant directly after its forward form. */
const sortColormaps = (names: string[]): string[] =>
    [...names].sort((a, b) => {
        const aBase = a.replace(/_r$/, '')
        const bBase = b.replace(/_r$/, '')
        if (aBase !== bBase) return aBase.localeCompare(bBase)
        return a.endsWith('_r') ? 1 : -1
    })

/**
 * Ramp names the tiling service reports, sorted with each ramp's reversed
 * variant directly after its forward form. With no service supplied, or one
 * whose list cannot be read, the installed fallback's ramps are listed
 * instead (see setColormapFallback). Resolves to null when neither has a list,
 * which callers surface as "ramps unavailable" rather than an empty list.
 */
export const useAvailableColormaps = (titilerUrl: string | null = null): Result => {
    const baseUrl = resolveTiTilerBase(titilerUrl)
    const fallback = getColormapFallback()
    const [colormaps, setColormaps] = useState<string[] | null>(null)
    // Anything to ask is presumed to be loading from the first render, before
    // the effect has had a chance to start the request. Without that, the
    // empty initial list is indistinguishable from "no ramps exist" and
    // callers flash an unavailable state on every mount.
    const [loading, setLoading] = useState(() => baseUrl != null || fallback != null)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        let cancelled = false
        const fromService = async (): Promise<string[] | null> => {
            if (baseUrl == null) return null
            try {
                const response = await fetch(`${baseUrl}/colorMaps`)
                if (!response.ok) throw new Error(`Failed to fetch colormaps: ${response.status}`)
                return parseColormapList(await response.json())
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to fetch available colormaps:', err)
                    setError(err as Error)
                }
                return null
            }
        }
        const load = async () => {
            setLoading(baseUrl != null || fallback != null)
            setError(null)
            const list =
                (await fromService()) ??
                (await fallback?.list().catch(() => null)) ??
                null
            if (cancelled) return
            setColormaps(list ? sortColormaps(list) : null)
            setLoading(false)
        }
        load()
        return () => {
            cancelled = true
        }
    }, [baseUrl, fallback])

    return { colormaps, loading, error }
}
