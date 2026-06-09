/**
 * Shared drawing helpers used by both engine adapters' terra-draw integrations.
 */

/**
 * terra-draw transitions geometry types as a polygon is drawn:
 * 1 vertex → Point, 2 vertices → LineString, 3+ vertices → Polygon.
 * Rectangle / circle modes go straight to Polygon. Normalise to a
 * vertex list in {lat, lng} form for the `drawvertex` event.
 */
export function extractVerticesFromGeometry(
    geom: GeoJSON.Geometry
): { lat: number; lng: number }[] | null {
    if (geom.type === 'Point') {
        const c = geom.coordinates
        return [{ lng: c[0], lat: c[1] }]
    }
    if (geom.type === 'LineString') {
        return geom.coordinates.map((c) => ({ lng: c[0], lat: c[1] }))
    }
    if (geom.type === 'Polygon') {
        const ring = geom.coordinates[0] ?? []
        // Polygon ring repeats first vertex at the end — strip the duplicate.
        const trimmed = ring.length > 1 ? ring.slice(0, -1) : ring
        return trimmed.map((c) => ({ lng: c[0], lat: c[1] }))
    }
    return null
}
