import { distance, point } from '@turf/turf'
import type { LatLng } from '../types'

const MEASURE_WEIGHT = 3
const MEASURE_RADIUS = 4
/** Width of the white edge showing on each side of the line and endpoints. */
const CASING_WIDTH = 1

function pathStyle(color: string, weight: number) {
    return {
        color,
        weight,
        opacity: 1,
        lineCap: 'round',
        radius: MEASURE_RADIUS,
        fillColor: color,
        fillOpacity: 1,
    }
}

/** Measure line + endpoints in the theme primary. */
export function measureStyle() {
    const primary =
        getComputedStyle(document.documentElement)
            .getPropertyValue('--theme-color-primary')
            .trim() || '#1c67e3'
    return pathStyle(primary, MEASURE_WEIGHT)
}

/** White casing drawn beneath {@link measureStyle}. */
export function measureCasingStyle() {
    return pathStyle('#ffffff', MEASURE_WEIGHT + CASING_WIDTH * 2)
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
