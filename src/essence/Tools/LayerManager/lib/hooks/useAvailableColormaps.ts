import { useEffect, useState } from 'react'
import { getColormapSource } from '../utils/colormapSource'

type Result = {
    colormaps: string[] | null
    loading: boolean
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
 * The ramp names the host offers for a layer, sorted with each ramp's
 * reversed variant directly after its forward form. Null when the host has no
 * list, which callers surface as "ramps unavailable" rather than an empty list.
 */
export const useAvailableColormaps = (layerId: string): Result => {
    const source = getColormapSource()
    const [colormaps, setColormaps] = useState<string[] | null>(null)
    // Presumed loading from the first render, before the effect has had a
    // chance to ask. Without that, the empty initial list is indistinguishable
    // from "no ramps exist" and callers flash an unavailable state on every
    // mount.
    const [loading, setLoading] = useState(() => source != null)

    useEffect(() => {
        let cancelled = false
        setLoading(source != null)
        const load = async () => {
            const list = source
                ? await source.list(layerId).catch((err) => {
                      console.warn('Failed to list colormaps:', err)
                      return null
                  })
                : null
            if (cancelled) return
            setColormaps(list ? sortColormaps(list) : null)
            setLoading(false)
        }
        load()
        return () => {
            cancelled = true
        }
    }, [layerId, source])

    return { colormaps, loading }
}
