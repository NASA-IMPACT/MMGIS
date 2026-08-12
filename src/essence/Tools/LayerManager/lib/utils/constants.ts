export const LAYER_TYPES = {
    TILE: 'tile',
    IMAGE: 'image',
    VECTOR: 'vector',
    HEADER: 'header',
    DATA: 'data',
    MODEL: 'model',
    VECTORTILE: 'vectortile',
} as const

export const LEGEND_TYPES = {
    GRADIENT: 'gradient',
    CATEGORICAL: 'categorical',
    TEXT: 'text',
    NONE: 'none',
} as const

export const COG_SUPPORTED_TYPES = [LAYER_TYPES.TILE, LAYER_TYPES.IMAGE]

/** Screen-pixel margin left around a layer's extent when zooming to it. */
export const ZOOM_TO_LAYER_PADDING = 40

/**
 * How far in a zoom-to-layer may go when the layer's extent encloses no area —
 * a layer whose features all sit at one point. Such an extent fits to maximum
 * zoom, far past any tile the layer serves.
 *
 * An extent with area is fitted uncapped, so a small high-resolution layer
 * still zooms to the detail it actually carries.
 */
export const ZOOM_TO_LAYER_POINT_MAX_ZOOM = 16
