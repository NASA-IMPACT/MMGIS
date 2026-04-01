import type { IMapEngine } from '../IMapEngine'

/**
 * Map engine identifiers. Each mission is configured with one engine
 * and that engine cannot be changed after mission creation.
 */
export const MAP_ENGINE = {
    LEAFLET: 'leaflet',
    DECKGL: 'deckgl',
} as const

export type MapEngineType = (typeof MAP_ENGINE)[keyof typeof MAP_ENGINE]

/**
 * Renderable layer types that an engine can actually draw.
 * Not every engine supports every type.
 */
export type RenderableLayerType =
    | 'vector'
    | 'tile'
    | 'vectortile'
    | 'data'
    | 'image'
    | 'model'
    | 'video'
    | 'velocity'
    | 'pointcloud'

/**
 * Structural layer types used by MMGIS for UI and data fetching.
 * These are not rendered by any engine directly.
 *   query:  fetches data on demand, rendered as vector once loaded
 *   header: grouping label in the layer tree, never rendered
 */
export type StructuralLayerType = 'query' | 'header'

/**
 * All MMGIS layer types. Union of renderable and structural.
 */
export type LayerType = RenderableLayerType | StructuralLayerType

/**
 * Which renderable layer types each engine supports.
 *
 * Leaflet:
 *   vector, tile, vectortile (via L.VectorGrid plugin),
 *   data (via L.TileLayer.GL), image (via georaster plugin),
 *   video (L.VideoOverlay), velocity (leaflet-velocity plugin)
 *
 * deck.gl:
 *   vector (GeoJsonLayer), tile (TileLayer/BitmapLayer),
 *   pointcloud (PointCloudLayer, high density point data)
 *   Basemap rendering (Mapbox/MapLibre) is an internal detail
 *   of the deck.gl adapter and not exposed as a separate engine.
 */
export const ENGINE_LAYER_SUPPORT: Record<MapEngineType, RenderableLayerType[]> = {
    [MAP_ENGINE.LEAFLET]: ['vector', 'tile', 'vectortile', 'data', 'image', 'video', 'velocity'],
    [MAP_ENGINE.DECKGL]: ['vector', 'tile', 'pointcloud'],
}

/**
 * Check if a given engine supports a renderable layer type.
 */
export function engineSupportsLayer(
    engine: MapEngineType,
    layerType: RenderableLayerType
): boolean {
    return ENGINE_LAYER_SUPPORT[engine].includes(layerType)
}

/**
 * Constructor signature for a class that implements IMapEngine.
 * Used by the MapEngineRegistry to instantiate adapters.
 */
export type MapEngineAdapterClass = new (...args: unknown[]) => IMapEngine

/**
 * Metadata a tool declares so the configuration UI can show
 * or hide tools based on the mission's selected engine.
 */
export interface ToolEngineSupport {
    toolName: string
    supportedEngines: MapEngineType[]
}
