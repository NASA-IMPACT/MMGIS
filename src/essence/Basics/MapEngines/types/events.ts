import { LatLngLike, PointLike } from './geometry'

/**
 * Handler signature for map events.
 */
export type MapEventHandler<TEvent = unknown> = (event: TEvent) => void

/**
 * Options when subscribing to a map event.
 */
export interface MapEventOptions {
    once?: boolean
}

/**
 * Result of a feature pick from click, hover, or spatial query.
 * Each engine fills this from its own picking system:
 *   Leaflet uses DOM event propagation on vector layers
 *   deck.gl uses GPU based picking (pickObject / pickMultipleObjects)
 */
export interface FeaturePickResult {
    feature: Record<string, unknown> | null
    layerId?: string
    latlng?: LatLngLike
    pixel?: PointLike
}

/**
 * Callback for feature level interactions (click, hover, spatial query).
 */
export type FeatureInteractionHandler = (result: FeaturePickResult) => void

/**
 * Options for spatial feature queries.
 * Leaflet and deck.gl adapters implement this using their
 * own picking mechanisms.
 */
export interface QueryFeaturesOptions {
    layers?: string[]
    filter?: unknown[]
}

/**
 * Supported interactive drawing shapes.
 *
 * `'point'`      — single click places a Point feature.
 * `'linestring'` — click-to-add-vertex, finalised on double-click or Enter.
 *                  Returns a LineString geometry.
 * `'polygon'`    — n-vertex polygon, click-to-add-vertex, finalised on
 *                  double-click or Enter.
 * `'rectangle'`  — two corner clicks define an axis-aligned rectangle.
 * `'circle'`     — first click sets the center; second click sets the radius.
 *                  Returned geometry is a Polygon approximation so downstream
 *                  consumers don't need a special `Circle` code path.
 */
export type DrawShape = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle'

/**
 * Options for `IMapEngine.enableDrawing`. `style` follows the same shape as
 * `GeoJSONLayerOptions.style` — adapters apply it to the in-progress preview
 * layer and to the final committed feature's stroke / fill.
 */
export interface DrawingOptions {
    style?: Record<string, unknown>
    finishOnDoubleClick?: boolean
    cancelOnEscape?: boolean
}

/**
 * Payload for the `drawstart` engine event.
 */
export interface DrawStartEvent {
    shape: DrawShape
}

/**
 * Payload for the `drawvertex` engine event. Fires for committed vertices only
 * (not mouse-move preview). Rectangle and circle finish on their second click,
 * so they report a single vertex — the placed corner or center. Consumers
 * wanting the final geometry should use `drawcomplete`.
 */
export interface DrawVertexEvent {
    shape: DrawShape
    vertices: LatLngLike[]
}

/**
 * Payload for the `drawcomplete` engine event. The adapter calls
 * `disableDrawing()` internally before emitting.
 */
export interface DrawCompleteEvent {
    feature: GeoJSON.Feature
}

/**
 * Payload for the `drawcancel` engine event. Fires when the user pressed
 * Escape (when `DrawingOptions.cancelOnEscape !== false`) or when the plugin
 * called `disableDrawing()` mid-draw.
 */
export interface DrawCancelEvent {
    shape: DrawShape
}
