import { useEffect, useState } from 'react'
import { getTiTilerBaseUrl } from '../utils/titiler'

type LayerConfig = { titilerUrl?: string | null } | null | undefined

type Result = {
    gradient: string | null
    colors: string[] | null
    loading: boolean
    error: Error | null
}

export const useColormapGradient = (
    colormapName: string | null | undefined,
    enabled = true,
    layerConfig: LayerConfig = null,
): Result => {
    const [gradient, setGradient] = useState<string | null>(null)
    const [colors, setColors] = useState<string[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
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
                if (baseUrl == null) {
                    // No TiTiler available (static build without one configured)
                    setGradient(null)
                    setColors(null)
                    return
                }
                const response = await fetch(`${baseUrl}/colorMaps/${colormapName}`)
                if (!response.ok) throw new Error(`Failed to fetch colormap: ${response.status}`)
                const data = (await response.json()) as Record<string, [number, number, number, number]>
                if (cancelled) return
                const keys = Object.keys(data).map(Number).sort((a, b) => a - b)
                const colorArray = keys.map((key) => {
                    const [r, g, b, a] = data[String(key)]
                    return `rgba(${r}, ${g}, ${b}, ${a / 255})`
                })
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
                    setError(err as Error)
                    setGradient(null)
                    setColors(null)
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        fetchColormapColors()
        return () => {
            cancelled = true
        }
    }, [colormapName, enabled, titilerUrl])

    return { gradient, colors, loading, error }
}
