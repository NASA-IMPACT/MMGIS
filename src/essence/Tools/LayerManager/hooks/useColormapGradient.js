import { useState, useEffect } from 'react'
import { getTiTilerUrl } from '../utils/titiler'

/**
 * Custom hook for fetching colormap colors and building CSS gradient
 *
 * @param {string} colormapName - Name of the colormap (e.g., 'viridis', 'rdbu_r')
 * @param {boolean} enabled - Whether to fetch the colormap (default: true)
 * @returns {{ gradient: string|null, colors: string[]|null, loading: boolean, error: Error|null }}
 */
const useColormapGradient = (colormapName, enabled = true) => {
    const [gradient, setGradient] = useState(null)
    const [colors, setColors] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

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
                const url = getTiTilerUrl(`/colorMaps/${colormapName}`)
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
    }, [colormapName, enabled])

    return { gradient, colors, loading, error }
}

export default useColormapGradient
