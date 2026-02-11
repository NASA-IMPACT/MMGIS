import { LatLngLike, BoundsLike, PaddingLike, PointLike } from './geometry'

/**
 * Full camera state. Leaflet adapter ignores bearing and pitch.
 * deck.gl uses all fields.
 */
export interface ViewState {
    center: LatLngLike
    zoom: number
    bearing?: number
    pitch?: number
}

/**
 * Options for animated view transitions.
 */
export interface ViewOptions {
    animate?: boolean
    duration?: number
    easeLinearity?: number
}

/**
 * Options for flyTo where center, zoom, bearing, pitch are all
 * part of a single object. Leaflet adapter ignores bearing and pitch.
 */
export interface FlyToOptions extends ViewOptions {
    center: LatLngLike
    zoom?: number
    bearing?: number
    pitch?: number
    speed?: number
    curve?: number
    padding?: PaddingLike
    offset?: PointLike
}

/**
 * Options for fitting bounds into the viewport.
 */
export interface FitBoundsOptions extends ViewOptions {
    padding?: PaddingLike
    maxZoom?: number
    offset?: PointLike
}

/**
 * Options passed when initializing a map engine.
 */
export interface MapInitOptions {
    containerId: string
    center?: LatLngLike
    zoom?: number
    minZoom?: number
    maxZoom?: number
    maxBounds?: BoundsLike | null
    bearing?: number
    pitch?: number
    zoomControl?: boolean
    keyboard?: boolean
    fadeAnimation?: boolean
    worldCopyJump?: boolean
    zoomDelta?: number
    zoomSnap?: number
    wheelPxPerZoomLevel?: number
    editable?: boolean
    projection?: ProjectionOptions
}

/**
 * Projection and CRS options. Used primarily by Leaflet for custom
 * planetary projections.
 */
export interface ProjectionOptions {
    epsg?: string
    proj4?: string
    origin?: PointLike
    bounds?: BoundsLike
    resolutions?: number[]
    radius?: number
}
