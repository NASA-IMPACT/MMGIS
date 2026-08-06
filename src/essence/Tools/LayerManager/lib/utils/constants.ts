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
