// Nominatim-style forward geocoding against a CONFIGURED endpoint — the
// provider URL never lives in code (services are external and swappable).
// Asks for polygon geometry (`polygon_geojson=1`) so admin areas filter by
// real shape; falls back to the result's bbox. Never throws: [] on failure.

import { bboxToPolygon } from './geo'

export interface GeocodeCandidate {
    id: string
    label: string
    geometry: Record<string, unknown>
}

export async function geocodeSearch(
    baseUrl: string,
    query: string,
    signal?: AbortSignal,
): Promise<GeocodeCandidate[]> {
    const q = query.trim()
    if (baseUrl === '' || q.length < 2) return []
    const url =
        `${baseUrl.replace(/\/$/, '')}/search` +
        `?format=json&polygon_geojson=1&limit=5&q=${encodeURIComponent(q)}`
    try {
        const res = await fetch(url, {
            headers: { 'Accept-Language': 'en' },
            signal,
        })
        if (!res.ok) return []
        const data: unknown = await res.json()
        if (!Array.isArray(data)) return []
        const candidates: GeocodeCandidate[] = []
        for (const item of data as Record<string, unknown>[]) {
            const label = typeof item.display_name === 'string' ? item.display_name : ''
            if (label === '') continue
            let geometry = item.geojson as Record<string, unknown> | undefined
            if (geometry == null && Array.isArray(item.boundingbox)) {
                const bbox = (item.boundingbox as unknown[]).map(Number)
                if (bbox.length === 4 && bbox.every(Number.isFinite)) {
                    geometry = bboxToPolygon(bbox as [number, number, number, number])
                }
            }
            if (geometry == null) continue
            candidates.push({ id: String(item.place_id ?? label), label, geometry })
        }
        return candidates
    } catch {
        return []
    }
}
