import { useState, useEffect } from 'react'
import { getTiTilerBaseUrl } from '../utils/titiler'

/**
 * Custom hook for fetching available colormaps from TiTiler
 *
 * @param {object} layerConfig - Optional layer configuration for external TiTiler URL
 * @returns {{ colormaps: string[]|null, loading: boolean, error: Error|null }}
 */
const useAvailableColormaps = (layerConfig = null) => {
    const [colormaps, setColormaps] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Extract titilerUrl as a primitive to avoid object reference changes triggering re-fetches
    const titilerUrl = layerConfig?.titilerUrl || null

    useEffect(() => {
        // Check if TiTiler is available (locally or externally)
        const hasTiTiler = window.mmgisglobal?.WITH_TITILER === 'true' || titilerUrl != null
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
                const url = `${baseUrl}/colorMaps`
                const response = await fetch(url)

                if (!response.ok) {
                    throw new Error(`Failed to fetch colormaps: ${response.status}`)
                }

                const data = await response.json()

                if (cancelled) return

                // TiTiler returns { colorMaps: [...] }
                const colormapList = data.colorMaps || []

                // Sort alphabetically, with non-reversed first
                const sorted = [...colormapList].sort((a, b) => {
                    // Put reversed colormaps (_r suffix) at the end of their base name
                    const aBase = a.replace(/_r$/, '')
                    const bBase = b.replace(/_r$/, '')
                    if (aBase !== bBase) {
                        return aBase.localeCompare(bBase)
                    }
                    // If same base, non-reversed comes first
                    return a.endsWith('_r') ? 1 : -1
                })

                setColormaps(sorted)
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to fetch available colormaps:', err)
                    setError(err)
                    setColormaps(null)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        fetchColormaps()

        return () => {
            cancelled = true
        }
    }, [titilerUrl])

    return { colormaps, loading, error }
}

export default useAvailableColormaps
