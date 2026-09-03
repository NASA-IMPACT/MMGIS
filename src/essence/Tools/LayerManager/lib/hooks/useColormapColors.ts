import { useEffect, useState } from 'react'
import { fetchColormapColors } from '../utils/colormapCache'
import { getBaseColormapName } from '../utils/colormaps'

type Result = {
    colors: string[] | null
    loading: boolean
}

/**
 * Resolve the colors of one ramp in a given direction.
 *
 * Only the forward ramp is ever fetched; the reversed form is the same colors
 * read backwards, so reversing locally keeps one cache entry per ramp and
 * guarantees a preview and its `_r` counterpart can never disagree.
 *
 * `enabled` lets a caller defer the request — the picker uses it to hold off
 * until a swatch scrolls into view.
 *
 * `localColormaps` resolves a ramp without a request.
 */
export const useColormapColors = (
    colormapName: string | null | undefined,
    reversed: boolean,
    titilerUrl?: string | null,
    enabled = true,
    localColormaps?: Record<string, string[]> | null,
): Result => {
    const [colors, setColors] = useState<string[] | null>(null)
    const [loading, setLoading] = useState(false)
    // Lowercased so a layer configured with any casing hits the same cache
    // entry as the picker's list, and resolves against a service that names
    // its ramps in lowercase.
    const base = getBaseColormapName(colormapName).toLowerCase()

    useEffect(() => {
        if (!enabled || !base) {
            setColors(null)
            setLoading(false)
            return
        }
        let cancelled = false
        setLoading(true)
        fetchColormapColors(base, titilerUrl, localColormaps).then((resolved) => {
            if (cancelled) return
            setColors(resolved)
            setLoading(false)
        })
        return () => {
            cancelled = true
        }
    }, [base, titilerUrl, enabled, localColormaps])

    return {
        colors: colors && reversed ? [...colors].reverse() : colors,
        loading,
    }
}
