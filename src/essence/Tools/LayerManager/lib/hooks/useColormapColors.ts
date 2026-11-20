import { useEffect, useState } from 'react'
import { getColormapSource } from '../utils/colormapSource'
import { getBaseColormapName } from '../utils/colormaps'

type Result = {
    colors: string[] | null
    loading: boolean
}

/**
 * Resolve the colors of one ramp in a given direction.
 *
 * Only the forward ramp is ever asked for; the reversed form is the same
 * colors read backwards, so a preview and its `_r` counterpart can never
 * disagree.
 *
 * `enabled` lets a caller defer the request — the picker uses it to hold off
 * until a swatch scrolls into view.
 */
export const useColormapColors = (
    colormapName: string | null | undefined,
    reversed: boolean,
    layerId: string,
    enabled = true,
): Result => {
    const [colors, setColors] = useState<string[] | null>(null)
    const [loading, setLoading] = useState(false)
    // Lowercased so a layer configured with any casing resolves against a
    // service that names its ramps in lowercase.
    const base = getBaseColormapName(colormapName).toLowerCase()

    useEffect(() => {
        const source = getColormapSource()
        if (!enabled || !base || !source) {
            setColors(null)
            setLoading(false)
            return
        }
        let cancelled = false
        setLoading(true)
        source
            .colors(layerId, base)
            .catch(() => null)
            .then((resolved) => {
                if (cancelled) return
                setColors(resolved)
                setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [base, layerId, enabled])

    return {
        colors: colors && reversed ? [...colors].reverse() : colors,
        loading,
    }
}
