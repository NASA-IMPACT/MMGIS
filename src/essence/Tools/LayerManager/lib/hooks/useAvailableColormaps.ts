import { useEffect, useState } from 'react'
import { getTiTilerBaseUrl } from '../utils/titiler'

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

export const useAvailableColormaps = (layerConfig: Options = null): Result => {
    const [colormaps, setColormaps] = useState<string[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const titilerUrl = layerConfig?.titilerUrl || null

    useEffect(() => {
        const hasTiTiler =
            window.mmgisglobal?.WITH_TITILER === 'true' || titilerUrl != null
        if (!hasTiTiler) {
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
                const baseUrl = titilerUrl
                    ? titilerUrl.replace(/\/$/, '')
                    : getTiTilerBaseUrl()
                const response = await fetch(`${baseUrl}/colorMaps`)
                if (!response.ok) throw new Error(`Failed to fetch colormaps: ${response.status}`)
                const data = (await response.json()) as { colorMaps?: string[] }
                if (cancelled) return
                const colormapList = data.colorMaps || []
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
