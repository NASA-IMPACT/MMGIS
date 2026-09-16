import { mmgisRequest } from './mmgisAPI'
import type { BasemapStyle } from '../lib'

/** Pull the basemap style list + active style from the map engine via the bus. */
export async function getBasemaps(): Promise<{
    styles: BasemapStyle[]
    active: BasemapStyle | null
}> {
    const [styles, active] = await Promise.all([
        mmgisRequest<BasemapStyle[]>('map:getBasemapStyles'),
        mmgisRequest<BasemapStyle | null>('map:getBasemap'),
    ])
    const s = styles || []
    return { styles: s, active: active || s[0] || null }
}
