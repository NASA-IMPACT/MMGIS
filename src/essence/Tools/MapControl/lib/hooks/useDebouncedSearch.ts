import { useEffect, useRef, useState } from 'react'
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
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current)
        if (query.length < 2) {
            setResults([])
            setLoading(false)
            return
        }
        setLoading(true)
        timer.current = setTimeout(async () => {
            const r = await geocodeSearch(query)
            setResults(r)
            setLoading(false)
        }, DEBOUNCE_MS)
        return () => {
            if (timer.current) clearTimeout(timer.current)
        }
    }, [query])

    return { results, loading }
}
