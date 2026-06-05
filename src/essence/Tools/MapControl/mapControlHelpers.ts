import { distance, point } from '@turf/turf'

export type LatLng = { lat: number; lng: number }
export type BasemapStyle = { name: string }
export type GeocodeResult = {
    id: string
    displayName: string
    lat: number
    lng: number
    // Nominatim boundingbox: [min_lat, max_lat, min_lon, max_lon]
    bbox: [number, number, number, number]
}
export type MapOverlayOpts = {
    id: string
    geojson: object
    style: object
}
export type MapSubscribeHandlers = {
    onClick: (e: LatLng) => void
    onMouseMove: (e: LatLng) => void
}

export const MEASURE_STYLE = {
    color: '#1b1b1b',
    weight: 2,
    opacity: 1,
    dashArray: '2 6',
    lineCap: 'round',
    radius: 4,
    fillColor: '#1b1b1b',
    fillOpacity: 1,
}

const BASEMAP_GRADIENTS: Record<string, string> = {
    streets:  'linear-gradient(135deg,#f0ebe0,#ddd0b8,#bca888)',
    satellite:'linear-gradient(135deg,#0c1f2e,#163b20,#0a2e0a)',
    outdoors: 'linear-gradient(135deg,#e0f5c8,#88c458,#4a8030)',
    light:    'linear-gradient(135deg,#fff,#ebebeb,#d4d4d4)',
    dark:     'linear-gradient(135deg,#2c2c3a,#1a1a28,#0c0c18)',
    terrain:  'linear-gradient(135deg,#d4edbc,#6ab040,#3d6e28)',
    liberty:  'linear-gradient(135deg,#f5e6ca,#d4a853,#8b7355)',
    bright:   'linear-gradient(135deg,#dff0fb,#93cce8,#4a9ec4)',
    positron: 'linear-gradient(135deg,#f8f8f8,#e0e0e0,#b8b8b8)',
}
const DEFAULT_BG = 'linear-gradient(135deg,#4a90d9,#2a6db8,#1450a0)'

export function basemapGradient(name: string): string {
    const k = (name || '').toLowerCase()
    const entry = Object.entries(BASEMAP_GRADIENTS).find(([key]) => k.includes(key))
    return entry ? entry[1] : DEFAULT_BG
}

export function measureDistance(a: LatLng, b: LatLng): number {
    return distance(
        point([a.lng, a.lat]),
        point([b.lng, b.lat]),
        { units: 'meters' }
    )
}

export function formatDistance(meters: number): string {
    if (meters < 1000) {
        const ft = meters * 3.28084
        return `${ft.toFixed(0)} ft (${meters.toFixed(1)} m)`
    }
    const mi = meters * 0.000621371
    const km = meters / 1000
    return `${mi.toFixed(2)} mi (${km.toFixed(2)} km)`
}

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
