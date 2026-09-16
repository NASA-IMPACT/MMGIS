import { parseNamingProperties } from '../Layers_/namingProperty'

/**
 * A feature pick reported by a map engine adapter.
 */
export interface FeaturePick {
    feature?: Record<string, any> | null
    layerId?: string
}

/**
 * GeoJSON layer types, which Leaflet has always given a hover label. Other
 * types reach the hover callback too — raster tiles, 3D tiles, and point
 * layers of plain records — but carry no feature properties to name.
 */
const VECTOR_TYPES = new Set(['vector', 'query', 'GeoJsonLayer'])

/**
 * Layer types served by makeVectorTileLayer. They carry their own
 * single-property hover setting, which predates the general one and has the
 * opposite idea of what "unset" means.
 */
const VECTOR_TILE_TYPES = new Set(['vectortile', 'MVTLayer'])

export interface HoverLabelDeps {
    /** Layers_.getLayersChosenNamePropVal */
    getNamePropVal: (
        feature: Record<string, any>,
        layerName: string,
    ) => Record<string, unknown>
}

/**
 * Works out what to show while hovering a picked feature, or null to show
 * nothing.
 *
 * A layer's configured naming properties win wherever they are set, on either
 * layer type, so the same configuration reads the same way on both engines.
 *
 * The two layer types disagree about an empty configuration, and that
 * disagreement is preserved deliberately. A vector layer with nothing
 * configured falls back to its first usable property, which is what the
 * Leaflet path has always done. A vector tile layer falls back only to its own
 * single-property setting, and shows nothing when that is unset too, so
 * layers that deliberately hover blank stay blank.
 */
export const resolveFeatureHoverLabel = (
    pick: FeaturePick | undefined | null,
    layersData: Record<string, any> | undefined | null,
    deps: HoverLabelDeps,
): Record<string, unknown> | string | null => {
    const layerName = pick?.layerId
    const feature = pick?.feature

    if (!layerName || !feature) return null
    if (feature.properties == null || typeof feature.properties !== 'object')
        return null

    const config = layersData?.[layerName]
    if (!config) return null

    const isVectorTile = VECTOR_TILE_TYPES.has(config.type)
    if (!isVectorTile && !VECTOR_TYPES.has(config.type)) return null

    if (parseNamingProperties(config.variables?.useKeyAsName).length > 0)
        return deps.getNamePropVal(feature, layerName)

    if (isVectorTile) {
        const vtKey = config.style?.vtKey
        if (!vtKey) return null
        const value = feature.properties[vtKey]
        return value == null ? null : `${vtKey}: ${value}`
    }

    return deps.getNamePropVal(feature, layerName)
}
