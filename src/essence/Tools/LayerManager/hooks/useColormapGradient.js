import { useState, useEffect } from 'react'
import { getTiTilerBaseUrl } from '../utils/titiler'

/**
 * Custom hook for fetching colormap colors and building CSS gradient
 *
 * @param {string} colormapName - Name of the colormap (e.g., 'viridis', 'rdbu_r')
 * @param {boolean} enabled - Whether to fetch the colormap (default: true)
 * @param {object} layerConfig - Optional layer configuration for external TiTiler URL
 * @returns {{ gradient: string|null, colors: string[]|null, loading: boolean, error: Error|null }}
 */
const useColormapGradient = (colormapName, enabled = true, layerConfig = null) => {
    const [gradient, setGradient] = useState(null)
    const [colors, setColors] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Extract titilerUrl as a primitive to avoid object reference changes triggering re-fetches
    const titilerUrl = layerConfig?.titilerUrl || null

    useEffect(() => {
        if (!enabled || !colormapName) {
            setGradient(null)
            setColors(null)
            setLoading(false)
            setError(null)
            return
        }

        let cancelled = false

        const fetchColormapColors = async () => {
            setLoading(true)
            setError(null)

            try {
                const baseUrl = titilerUrl
                    ? titilerUrl.replace(/\/$/, '')
                    : getTiTilerBaseUrl()
                const url = `${baseUrl}/colorMaps/${colormapName}`
                const response = await fetch(url)

                if (!response.ok) {
                    throw new Error(`Failed to fetch colormap: ${response.status}`)
                }

                const data = await response.json()

                if (cancelled) return

                // Extract colors from the colormap data (format: {0: [r,g,b,a], 1: [r,g,b,a], ...})
                const keys = Object.keys(data).map(Number).sort((a, b) => a - b)
                const colorArray = keys.map(key => {
                    const [r, g, b, a] = data[key]
                    return `rgba(${r}, ${g}, ${b}, ${a / 255})`
                })

                // Build CSS gradient
                if (colorArray.length > 0) {
                    const d = 100 / (colorArray.length - 1)
                    const steps = colorArray.map((c, i) => `${c} ${i * d}%`)
                    setGradient(`linear-gradient(to right, ${steps.join(', ')})`)
                    setColors(colorArray)
                } else {
                    setGradient(null)
                    setColors(null)
                }
            } catch (err) {
                if (!cancelled) {
                    console.warn('Failed to fetch colormap colors:', err)
                    setError(err)
                    setGradient(null)
                    setColors(null)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        fetchColormapColors()

        return () => {
            cancelled = true
        }
    }, [colormapName, enabled, titilerUrl])

    return { gradient, colors, loading, error }
}

export default useColormapGradient
