import { distance, point } from '@turf/turf'
import type { LatLng } from '../types'

/** Leaflet-path style for the measure line + endpoints. */
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

export function measureDistance(a: LatLng, b: LatLng): number {
    return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'meters' })
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
