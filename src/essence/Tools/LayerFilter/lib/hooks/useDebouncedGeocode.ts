// Debounced geocode search (mirrors MapControl's pattern): 300ms settle,
// aborts superseded requests so a slow older response can't clobber newer
// results after the user keeps typing.
import { useEffect, useState } from 'react'
import { geocodeSearch, type GeocodeCandidate } from '../utils/geocode'

const DEBOUNCE_MS = 300

export function useDebouncedGeocode(
    baseUrl: string,
    query: string,
): { results: GeocodeCandidate[]; loading: boolean } {
    const [results, setResults] = useState<GeocodeCandidate[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (baseUrl === '' || query.trim().length < 2) {
            setResults([])
            setLoading(false)
            return
        }
        setLoading(true)
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            const r = await geocodeSearch(baseUrl, query, controller.signal)
            if (controller.signal.aborted) return
            setResults(r)
            setLoading(false)
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [baseUrl, query])

    return { results, loading }
}
