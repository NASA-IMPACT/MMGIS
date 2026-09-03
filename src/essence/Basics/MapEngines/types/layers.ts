import { LatLngLike, BoundsLike } from './geometry'
import { LayerType } from './engine'

/**
 * Base layer options shared across all layer types.
 */
export interface LayerOptions {
    id?: string
    type?: LayerType
    url?: string
    bounds?: BoundsLike
    opacity?: number
    zIndex?: number
    minZoom?: number
    maxZoom?: number
    interactive?: boolean
    visible?: boolean
    style?: Record<string, unknown>
    /**
     * The layer's legend rows (`L_.layers.data[<layer>]._legend`). Rows flagged
     * `styleMatching` double as a style specification, colouring each feature
     * from one of its property values; see LegendStyle. With no legend, or none
     * carrying such rows, the engine styles from `style` alone.
     */
    legend?: unknown
    /**
     * Whether the mission configures a legend at all, including one still
     * being fetched. Distinct from `legend` above, which is the legend once it
     * has arrived: a `legend:` CSV path routinely lands after the layer is
     * built, and a vector tile layer has to know at build time — see the
     * `vectortile` case in buildDeckLayer.
     */
    legendConfigured?: boolean
    metadata?: Record<string, unknown>
}

/**
 * Options for tile layers (raster XYZ or TMS).
 *
 * Leaflet: creates L.TileLayer with url template and tms flag.
 * deck.gl: creates a TileLayer with renderSubLayers returning
 *   BitmapLayer for raster tiles. The url template uses {x},{y},{z}
 *   placeholders just like Leaflet.
 *
 * deck.gl specific props (tileSize, maxCacheSize, refinementStrategy,
 * maxRequests, debounceTime, onTileLoad, onTileError) are passed
 * through via the nativeOptions escape hatch so that the adapter
 * can forward them directly to deck.gl's TileLayer constructor.
 */
export interface TileLayerOptions extends LayerOptions {
    tms?: boolean
    subdomains?: string | string[]
    attribution?: string
    time?: string
    maxNativeZoom?: number
    tileSize?: number
    tileElevation?: number
    /** 'wms' => deck.gl WMSLayer; else a {z}/{x}/{y} url template. */
    tileformat?: string
    nativeOptions?: Record<string, unknown>
}

/**
 * Options for GeoJSON vector layers.
 *
 * Leaflet: creates L.GeoJSON using the callback props directly.
 * deck.gl: creates a GeoJsonLayer. The adapter maps vectorConfig style fields:
 *   style.fillColor (hex) + style.fillOpacity → getFillColor [r,g,b,a]
 *   style.color (hex) + style.opacity → getLineColor [r,g,b,a]
 *   style.weight → getLineWidth (pixels)
 *   style.radius → getPointRadius (pixels)
 *
 * deck.gl GeoJsonLayer specific props like pointType, lineWidthUnits,
 * lineJointRounded, elevationScale, extruded, material etc. are passed
 * through via the nativeOptions escape hatch.
 */
export interface GeoJSONLayerOptions<TLayer = unknown> extends Omit<LayerOptions, 'style'> {
    geojson: Record<string, unknown>
    style?: Record<string, unknown> | ((feature: Record<string, unknown>) => Record<string, unknown>)
    onEachFeature?: (feature: Record<string, unknown>, layer: TLayer) => void
    pointToLayer?: (feature: Record<string, unknown>, latlng: LatLngLike) => TLayer
    filter?: (feature: Record<string, unknown>) => boolean
    filled?: boolean
    stroked?: boolean
    extruded?: boolean
    pointType?: string
    lineWidthUnits?: 'pixels' | 'meters' | 'common'
    variables?: {
        markerIcon?: {
            iconUrl?: string
            iconSize?: [number, number]
            iconAnchor?: [number, number]
        }
        [key: string]: unknown
    }
    nativeOptions?: Record<string, unknown>
}

/**
 * Options for image overlay layers (GeoTIFF, raster overlays).
 */
export interface ImageOverlayOptions extends LayerOptions {
    bounds: BoundsLike
    colorScale?: string
    clampLow?: boolean
    clampHigh?: boolean
}

/**
 * Options for vector tile (MVT/protobuf) layers.
 */
export interface VectorTileLayerOptions extends LayerOptions {
    vectorTileLayerStyles?: Record<string, unknown>
    maxNativeZoom?: number
    attribution?: string
    nativeOptions?: Record<string, unknown>
}

/**
 * Options for point cloud layers.
 * deck.gl renders these via PointCloudLayer for high density datasets.
 * Currently only supported by the deck.gl engine.
 *
 * The adapter forwards pointSize, sizeUnits, and material directly
 * to deck.gl's PointCloudLayer. Data accessors (getPosition, getNormal,
 * getColor) are wired by the
 * adapter based on the data shape or can be overridden via nativeOptions.
 *
 * For LAS/LAZ files pass the url as data and provide the LASLoader
 * in the loaders array. The adapter will forward loaders to deck.gl.
 */
export interface PointCloudLayerOptions extends LayerOptions {
    data?: string | Record<string, unknown>
    pointSize?: number
    sizeUnits?: 'pixels' | 'meters' | 'common'
    material?: Record<string, unknown>
    coordinateSystem?: string
    coordinateOrigin?: [number, number] | [number, number, number]
    loaders?: unknown[]
    nativeOptions?: Record<string, unknown>
}

/**
 * Marker options for creating or updating markers.
 */
export interface MarkerOptions {
    id?: string
    position: LatLngLike
    icon?: IconOptions
    draggable?: boolean
    interactive?: boolean
    zIndexOffset?: number
    rotation?: number
    metadata?: Record<string, unknown>
}

/**
 * Icon configuration for markers.
 */
export interface IconOptions {
    url?: string
    size?: [number, number]
    anchor?: [number, number]
    className?: string
    color?: string
    scale?: number
    element?: HTMLElement
}

/**
 * Anchored HTML overlay attached to a geographic point.
 *
 * The engine creates a DOM node, anchors it to `latlng`, and keeps it
 * positioned across map view changes. The caller passes `mount` to render
 * content into the node and (optionally) returns a cleanup function the
 * engine runs on `removeOverlay` / engine destroy.
 */
export interface OverlayOptions {
    id: string
    latlng: LatLngLike
    mount: (node: HTMLElement) => (() => void) | void
}

/**
 * What a caller knows about a refresh, independent of engine. `url` is the
 * *uncompiled* tile source URL — Leaflet recompiles per tile from
 * `tileOptions`, deck.gl bakes them in with `compileTileUrl`. A refresher that
 * derives its own URL (client-side COG) ignores both.
 *
 * `url` is nullable, not merely optional: a source that resolves to nothing —
 * a `COG:` layer with no TiTiler service behind it — yields null, and callers
 * pass it through so the refresher, not the call site, decides what to do
 * with it. The domain-side refresher registered in `Map_.makeTileLayer` tests `ctx.url == null`.
 */
export type RefreshContext = {
    url?: string | null
    tileOptions?: Record<string, unknown>
    force?: boolean
}
