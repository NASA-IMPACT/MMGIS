import { mmgisRequest } from './mmgisAPI'
import type { BasemapStyle } from '../lib'

/** Pull the basemap style list, the active style, and whether the labels
 *  show (null when the engine cannot toggle them) from the map via the bus. */
export async function getBasemaps(): Promise<{
    styles: BasemapStyle[]
    active: BasemapStyle | null
    labelsVisible: boolean | null
}> {
    const [styles, active, supportsLabels] = await Promise.all([
        mmgisRequest<BasemapStyle[]>('map:getBasemapStyles'),
        mmgisRequest<BasemapStyle | null>('map:getBasemap'),
        mmgisRequest<boolean>('map:supportsBasemapLabels'),
    ])
    const labelsVisible =
        supportsLabels === true
            ? (await mmgisRequest<boolean>('map:getBasemapLabelsVisible')) !== false
            : null
    const s = styles || []
    return { styles: s, active: active || s[0] || null, labelsVisible }
}
