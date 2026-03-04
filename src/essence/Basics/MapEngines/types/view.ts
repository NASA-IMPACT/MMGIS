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
 * Raw keys sourced directly from MMGIS config.json.
 * A future translation layer should convert these into normalized
 * ProjectionOptions fields before handing them to an adapter.
 */
export interface RawMMGISProjectionConfig {
    globeproj?: string
    xmlpath?: string
    reszoomlevel?: string | number
    resunitsperpixel?: string | number
}

/**
 * Normalized projection and CRS options consumed by map engine adapters.
 * Extends RawMMGISProjectionConfig so adapters can read raw config fields
 * directly today. TODO: introduce a translation layer that converts
 * RawMMGISProjectionConfig → ProjectionOptions before calling the adapter,
 * then remove the extends here.
 */
export interface ProjectionOptions extends RawMMGISProjectionConfig {
    epsg?: string
    proj4?: string
    origin?: PointLike
    bounds?: BoundsLike
    /** Pre-computed resolution ladder. When absent, derived from RawMMGISProjectionConfig. */
    resolutions?: number[]
    radius?: number
    custom?: boolean
    /** Fallback proj4 string sourced from the raw MMGIS config. */
    proj?: string
    /** Maximum number of resolution levels to generate (defaults to maxZoom or 20). */
    maxResolutionLevels?: number
}
