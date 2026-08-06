import { useEffect, useState } from 'react'
import { resolveTiTilerBase } from '../utils/colormapCache'
import { parseColormapList } from '../utils/colormaps'

type Options = { titilerUrl: string | null } | null

type Result = {
    colormaps: string[] | null
    loading: boolean
    error: Error | null
}

declare global {
    interface Window {
        mmgisglobal?: { WITH_TITILER?: string }
    }
}

const hasTiTilerConfigured = (titilerUrl: string | null): boolean =>
    window.mmgisglobal?.WITH_TITILER === 'true' || titilerUrl != null

/**
 * Ramp names the tiling service reports, sorted with each ramp's reversed
 * variant directly after its forward form. Resolves to null whenever no list
 * can be obtained — no TiTiler configured, or the request failed — which
 * callers surface as "ramps unavailable" rather than an empty list.
 */
export const useAvailableColormaps = (layerConfig: Options = null): Result => {
    const titilerUrl = layerConfig?.titilerUrl || null
    const [colormaps, setColormaps] = useState<string[] | null>(null)
    // A service that is configured is presumed to be loading from the first
    // render, before the effect has had a chance to start the request. Without
    // that, the empty initial list is indistinguishable from "no ramps exist"
    // and callers flash an unavailable state on every mount.
    const [loading, setLoading] = useState(() => hasTiTilerConfigured(titilerUrl))
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        if (!hasTiTilerConfigured(titilerUrl)) {
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
                const baseUrl = resolveTiTilerBase(titilerUrl)
                if (baseUrl == null) {
                    // No TiTiler available (static build without one configured)
                    setColormaps(null)
                    return
                }
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
    }, [titilerUrl])

    return { colormaps, loading, error }
}
