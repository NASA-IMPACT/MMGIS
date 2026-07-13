import type { GeocodeResult } from '../types'

/**
 * Geocode a place name via Nominatim (OpenStreetMap). No API key required.
 * Returns [] on empty/short queries or any failure (never throws).
 */
export async function geocodeSearch(query: string): Promise<GeocodeResult[]> {
    const q = query.trim()
    if (q.length < 2) return []
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`
    try {
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
        if (!res.ok) return []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any[] = await res.json()
        return data.map((item) => ({
            id: String(item.place_id),
            displayName: item.display_name as string,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            bbox: [
                parseFloat(item.boundingbox[0]),
                parseFloat(item.boundingbox[1]),
                parseFloat(item.boundingbox[2]),
                parseFloat(item.boundingbox[3]),
            ] as [number, number, number, number],
        }))
    } catch {
        return []
    }
}
