import { useEffect, useState } from 'react'
import type { GeocodeResult } from '../types'
import { geocodeSearch } from '../utils/geocode'

const DEBOUNCE_MS = 300

/** Debounced Nominatim search. Returns live results + loading for a query string. */
export function useDebouncedSearch(query: string): {
    results: GeocodeResult[]
    loading: boolean
} {
    const [results, setResults] = useState<GeocodeResult[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (query.length < 2) {
            setResults([])
            setLoading(false)
            return
        }
        setLoading(true)
        // Abort superseded requests so a slow older response can't clobber
        // newer results after the user keeps typing.
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            const r = await geocodeSearch(query, controller.signal)
            if (controller.signal.aborted) return
            setResults(r)
            setLoading(false)
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [query])

    return { results, loading }
}
