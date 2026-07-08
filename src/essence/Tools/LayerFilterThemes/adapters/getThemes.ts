import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import type { ThemeSummary } from '../lib/types'

export interface ThemesResult {
    themes: ThemeSummary[]
    defaultThemeId?: string
}

/** Pull the theme list from the LayerFilter tool over the bus. */
export async function getThemes(): Promise<ThemesResult> {
    const result = await mmgisRequest<ThemesResult>('layerFilter:getThemes')
    return result || { themes: [] }
}
