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

export type ColormapOption = { name: string; label: string }

export const COLORMAP_OPTIONS: ColormapOption[] = [
    // Sequential
    { name: 'viridis', label: 'Viridis' },
    { name: 'plasma', label: 'Plasma' },
    { name: 'inferno', label: 'Inferno' },
    { name: 'magma', label: 'Magma' },
    { name: 'cividis', label: 'Cividis' },
    // Sequential (single hue)
    { name: 'Greys', label: 'Greys' },
    { name: 'Purples', label: 'Purples' },
    { name: 'Blues', label: 'Blues' },
    { name: 'Greens', label: 'Greens' },
    { name: 'Oranges', label: 'Oranges' },
    { name: 'Reds', label: 'Reds' },
    // Sequential (multi-hue)
    { name: 'YlOrBr', label: 'Yellow-Orange-Brown' },
    { name: 'YlOrRd', label: 'Yellow-Orange-Red' },
    { name: 'OrRd', label: 'Orange-Red' },
    { name: 'PuRd', label: 'Purple-Red' },
    { name: 'RdPu', label: 'Red-Purple' },
    { name: 'BuPu', label: 'Blue-Purple' },
    { name: 'GnBu', label: 'Green-Blue' },
    { name: 'PuBu', label: 'Purple-Blue' },
    { name: 'YlGnBu', label: 'Yellow-Green-Blue' },
    { name: 'PuBuGn', label: 'Purple-Blue-Green' },
    { name: 'BuGn', label: 'Blue-Green' },
    { name: 'YlGn', label: 'Yellow-Green' },
    // Diverging
    { name: 'PiYG', label: 'Pink-Yellow-Green' },
    { name: 'PRGn', label: 'Purple-Green' },
    { name: 'BrBG', label: 'Brown-Blue-Green' },
    { name: 'PuOr', label: 'Purple-Orange' },
    { name: 'RdGy', label: 'Red-Grey' },
    { name: 'RdBu', label: 'Red-Blue' },
    { name: 'RdYlBu', label: 'Red-Yellow-Blue' },
    { name: 'RdYlGn', label: 'Red-Yellow-Green' },
    { name: 'Spectral', label: 'Spectral' },
    { name: 'coolwarm', label: 'Cool-Warm' },
    // Cyclic
    { name: 'twilight', label: 'Twilight' },
    { name: 'hsv', label: 'HSV' },
    // Misc
    { name: 'terrain', label: 'Terrain' },
    { name: 'ocean', label: 'Ocean' },
    { name: 'gist_earth', label: 'Earth' },
    { name: 'cubehelix', label: 'Cubehelix' },
    { name: 'rainbow', label: 'Rainbow' },
    { name: 'jet', label: 'Jet' },
    { name: 'turbo', label: 'Turbo' },
]

export const findColormapName = (lowercaseName: string | null | undefined): string => {
    if (!lowercaseName) return 'viridis'
    const baseName = lowercaseName.replace(/_r$/, '')
    const found = COLORMAP_OPTIONS.find(
        (cm) => cm.name.toLowerCase() === baseName.toLowerCase()
    )
    return found ? found.name : baseName
}
