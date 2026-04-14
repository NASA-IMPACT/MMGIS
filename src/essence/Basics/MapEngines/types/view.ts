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
 * Supported basemap providers for deck.gl and Leaflet overlay mode.
 *
 * `'maplibre'` uses MapLibre GL JS (open-source, no access token required).
 * `'mapbox'` uses Mapbox GL JS (requires a valid {@link BasemapOptions.accessToken}).
 */
export type BasemapProvider = 'mapbox' | 'maplibre'

/**
 * A named basemap style preset for the in-map style switcher control.
 * Each entry maps a user-friendly display name to a MapLibre/Mapbox style URL.
 *
 * @example
 * ```ts
 * { name: 'Streets', style: 'https://demotiles.maplibre.org/style.json' }
 * ```
 */
export interface BasemapStyleEntry {
    /** Display name shown in the style switcher. */
    name: string
    /** MapLibre/Mapbox style URL for this entry. */
    style: string
}

/**
 * Configuration for an optional vector-tile basemap rendered beneath map layers
 * for both the deck.gl and Leaflet adapters.
 *
 * **deck.gl**: Uses `@deck.gl/mapbox`'s `MapboxOverlay` to composite deck.gl layers
 * on top of a MapLibre/Mapbox GL basemap.
 *
 * **Leaflet**: Creates a MapLibre/Mapbox GL map behind a transparent Leaflet canvas
 * and synchronises pan/zoom events so the basemap and Leaflet layers stay aligned.
 *
 * The chosen provider's stylesheet must be imported in the application entry point:
 * `import 'maplibre-gl/dist/maplibre-gl.css'` or `import 'mapbox-gl/dist/mapbox-gl.css'`.
 *
 * `mapbox-gl` is an optional peer dependency; install it separately (`npm install mapbox-gl`)
 * when `provider` is set to `'mapbox'`. `maplibre-gl` is a regular dependency and always available.
 */
export interface BasemapOptions {
    /** The map library to use as the basemap. */
    provider: BasemapProvider
    /**
     * Map style URL or a Mapbox/MapLibre style JSON object URL.
     * This is the default/initial style that the basemap loads with.
     * @example 'https://demotiles.maplibre.org/style.json'
     * @example 'mapbox://styles/mapbox/streets-v12'
     */
    style: string
    /**
     * Mapbox GL access token. Required when {@link provider} is `'mapbox'`.
     * Ignored for `'maplibre'`.
     */
    accessToken?: string
    /**
     * Optional array of named style presets for the in-map style switcher control.
     * When provided, a floating UI selector lets the user switch between basemap
     * styles (e.g. Streets, Satellite, Terrain) at runtime.
     */
    styles?: BasemapStyleEntry[]
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
    /**
     * Optional vector-tile basemap to render beneath map layers.
     *
     * - **deck.gl**: renders via `MapboxOverlay` (overlay mode).
     * - **Leaflet**: renders a MapLibre/Mapbox GL map behind a transparent Leaflet canvas.
     *
     * When absent, both adapters fall back to their default (no basemap) behaviour.
     */
    basemap?: BasemapOptions
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
