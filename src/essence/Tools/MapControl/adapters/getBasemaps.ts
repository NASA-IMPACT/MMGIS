import { mmgisRequest } from './mmgisAPI'
import type { BasemapGroup, BasemapStyle } from '../lib'

/** Pull the basemap style list, the active style and the layer groups
 *  (empty when the engine cannot toggle layers) from the map via the bus. */
export async function getBasemaps(): Promise<{
    styles: BasemapStyle[]
    active: BasemapStyle | null
    groups: BasemapGroup[]
}> {
    const [styles, active, groups] = await Promise.all([
        mmgisRequest<BasemapStyle[]>('map:getBasemapStyles'),
        mmgisRequest<BasemapStyle | null>('map:getBasemap'),
        mmgisRequest<BasemapGroup[]>('map:getBasemapGroups'),
    ])
    const s = styles || []
    return { styles: s, active: active || s[0] || null, groups: groups || [] }
}
