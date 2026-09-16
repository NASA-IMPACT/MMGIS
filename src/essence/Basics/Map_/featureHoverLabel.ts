/**
 * A feature pick reported by a map engine adapter.
 */
export interface FeaturePick {
    feature?: Record<string, any> | null
    layerId?: string
}

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

    const config = layersData?.[layerName]
    if (!config) return null

    const configured = config.variables?.useKeyAsName
    const hasConfigured = Array.isArray(configured)
        ? configured.some((p: unknown) => typeof p === 'string' && p !== '')
        : typeof configured === 'string' && configured !== ''

    if (hasConfigured) return deps.getNamePropVal(feature, layerName)

    if (VECTOR_TILE_TYPES.has(config.type)) {
        const vtKey = config.style?.vtKey
        if (!vtKey) return null
        const value = feature.properties?.[vtKey]
        return value == null ? null : `${vtKey}: ${value}`
    }

    return deps.getNamePropVal(feature, layerName)
}
