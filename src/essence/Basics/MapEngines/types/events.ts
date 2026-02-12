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
