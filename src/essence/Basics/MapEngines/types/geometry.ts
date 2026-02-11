/**
 * Geographic coordinate as a named object.
 * Named fields avoid the lat/lng vs lng/lat ordering confusion
 * that exists between Leaflet ([lat, lng]) and deck.gl ([lng, lat]).
 * Adapters convert to the engine's native order internally.
 */
export interface LatLng {
    lat: number
    lng: number
    alt?: number
}

/**
 * Tuple in Leaflet order: [lat, lng] or [lat, lng, alt].
 * Only use this when interfacing with Leaflet APIs or existing
 * MMGIS config that already stores coordinates this way.
 */
export type LatLngTuple = [number, number] | [number, number, number]

/**
 * Tuple in GeoJSON/deck.gl order: [lng, lat] or [lng, lat, alt].
 * This is the GeoJSON standard and what deck.gl expects.
 */
export type LngLatTuple = [number, number] | [number, number, number]

/**
 * Accepts the named object, a Leaflet ordered tuple, or a GeoJSON ordered tuple.
 * When using tuples the adapter must know which order to expect.
 * Prefer the object form to avoid ambiguity.
 */
export type LatLngLike = LatLng | LatLngTuple

/**
 * A 2D point for pixel or projected coordinates.
 */
export interface Point {
    x: number
    y: number
}

/**
 * Accepts either object or tuple form of a 2D point.
 */
export type PointLike = Point | [number, number]

/**
 * Geographic bounds as southwest and northeast corners.
 */
export interface Bounds {
    southWest: LatLngLike
    northEast: LatLngLike
}

/**
 * Accepts either object or tuple form of bounds.
 */
export type BoundsLike = Bounds | [LatLngLike, LatLngLike]

/**
 * Padding for fitBounds and similar operations.
 * Single number applies equally to all sides.
 * Object form specifies each side independently.
 * Tuple is [top, right, bottom, left].
 */
export type PaddingLike =
    | number
    | { top: number; right: number; bottom: number; left: number }
    | [number, number, number, number]
