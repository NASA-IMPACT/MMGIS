export type TempLayerType = 'xyz' | 'wms' | 'wmts' | 'geojson'

/** What the modal collects from the user. */
export interface AddTempLayerInput {
    url: string
    displayName?: string
    type?: TempLayerType
}
