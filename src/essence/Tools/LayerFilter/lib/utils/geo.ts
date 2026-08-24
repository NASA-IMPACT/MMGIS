// Geometry predicates for the geocode facet. Pure; turf does the math.

import * as turf from '@turf/turf'

/** Nominatim-style bbox [minLat, maxLat, minLon, maxLon] → GeoJSON Polygon. */
export function bboxToPolygon(
    bbox: [number, number, number, number],
): Record<string, unknown> {
    const [minLat, maxLat, minLon, maxLon] = bbox
    return {
        type: 'Polygon',
        coordinates: [
            [
                [minLon, minLat],
                [maxLon, minLat],
                [maxLon, maxLat],
                [minLon, maxLat],
                [minLon, minLat],
            ],
        ],
    }
}

/**
 * STAC-order bbox tag ([west, south, east, north], `layer.properties.bbox`)
 * → GeoJSON Polygon; null for anything that isn't 4 finite numbers.
 * Antimeridian-crossing boxes are not handled.
 */
export function stacBboxToPolygon(value: unknown): Record<string, unknown> | null {
    if (!Array.isArray(value) || value.length !== 4) return null
    if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return null
    }
    const [west, south, east, north] = value as [number, number, number, number]
    return {
        type: 'Polygon',
        coordinates: [
            [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
            ],
        ],
    }
}

/**
 * True when two GeoJSON geometries touch/overlap/contain in any combination
 * (point-in-polygon included). False on missing or invalid geometry — a
 * geometry-less catalogue entry simply never matches a place filter.
 * (booleanDisjoint negated: our turf's typings don't expose booleanIntersects.)
 */
export function geometriesIntersect(a: unknown, b: unknown): boolean {
    if (a == null || b == null) return false
    try {
        return !turf.booleanDisjoint(
            a as turf.helpers.Geometry,
            b as turf.helpers.Geometry,
        )
    } catch {
        return false
    }
}
