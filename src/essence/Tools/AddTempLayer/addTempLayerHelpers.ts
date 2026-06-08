// Pure helpers for AddTempLayer — no MMGIS imports.
// Scaffold only: types + stub signatures. Real logic comes in a later step.

export type TempLayerType = 'xyz' | 'wms' | 'wmts' | 'geojson'

/** What the modal collects from the user. */
export interface AddTempLayerInput {
    url: string
    displayName?: string
    type?: TempLayerType
}

/** Validate that a string is a usable layer URL. (stub) */
export function validateUrl(url: string): boolean {
    return typeof url === 'string' && url.trim().length > 0
}

/** Best-effort detect the layer type from a URL. (stub) */
export function detectLayerType(_url: string): TempLayerType | null {
    return null
}

/**
 * Build an MMGIS layerObj from user input, ready for mmgisAPI.addLayer. (stub)
 * The per-type mapping (xyz / wms / wmts / geojson) is filled in later.
 */
export function buildLayerObj(_input: AddTempLayerInput): object | null {
    return null
}
