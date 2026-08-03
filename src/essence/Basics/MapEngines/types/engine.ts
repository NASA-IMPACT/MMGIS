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
 * Deck.gl native layer type identifiers matching the class names exported by
 * `@deck.gl/layers` and `@deck.gl/geo-layers`. Used in the configure UI and
 * forwarded to {@link buildDeckLayer} to construct the correct deck.gl layer.
 */
export type DeckGLLayerType =
    | 'GeoJsonLayer'
    | 'TileLayer'
    | 'BitmapLayer'
    | 'Tile3DLayer'
    | 'PointCloudLayer'
    | 'MVTLayer'
    | 'ScatterplotLayer'

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
    | DeckGLLayerType

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
    [MAP_ENGINE.DECKGL]: [
        'GeoJsonLayer',
        'TileLayer',
        'Tile3DLayer',
        'PointCloudLayer',
        'MVTLayer',
        'ScatterplotLayer',
    ],
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
 * Maps deck.gl class names (as stored in layer configs) to the canonical MMGIS
 * type string. deck.gl missions configure a layer by its deck.gl class name
 * while Leaflet missions use the MMGIS type, so several class names normalise
 * onto one type — `TileLayer` and `BitmapLayer` are both `tile`.
 *
 * Lives here rather than beside its consumer in DeckGLHelpers so that
 * engine-agnostic modules can read it without pulling in the deck.gl bundle.
 * Add entries here when new deck.gl layer types are introduced.
 */
export const DECKGL_TYPE_ALIAS: Partial<Record<DeckGLLayerType, string>> = {
    GeoJsonLayer: 'vector',
    ScatterplotLayer: 'scatterplot',
    TileLayer: 'tile',
    BitmapLayer: 'tile',
    Tile3DLayer: 'tile3d',
    PointCloudLayer: 'pointcloud',
    MVTLayer: 'vectortile',
}

/**
 * Normalises a configured `type` to the canonical MMGIS type. A deck.gl class
 * name maps through DECKGL_TYPE_ALIAS; anything else — an MMGIS type from a
 * Leaflet config, or a class name with no alias — passes through unchanged.
 */
export function toCanonicalLayerType(
    type: string | undefined | null
): string | undefined {
    if (type == null) return undefined
    return DECKGL_TYPE_ALIAS[type as DeckGLLayerType] ?? type
}

/**
 * True when a layer config is a raster tile layer on any engine — `tile` in a
 * Leaflet config, `TileLayer` or `BitmapLayer` in a deck.gl one. All of these
 * are built by Map_.makeTileLayer and share the tile-URL pipeline.
 *
 * Takes a loose `{ type?: string }` because callers pass raw mission-config
 * objects parsed from JSON, where `type` is whatever the config authored.
 */
export function isRasterTileLayerType(
    layer: { type?: string } | null | undefined
): boolean {
    return toCanonicalLayerType(layer?.type) === 'tile'
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
