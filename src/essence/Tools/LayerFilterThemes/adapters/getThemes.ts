import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import type { ThemeSummary } from '../lib/types'

export interface ThemesResult {
    themes: ThemeSummary[]
    defaultThemeId?: string
}

/** Pull the theme list from the LayerFilter tool over the bus. Resolves to an
 *  empty list when the panel plugin isn't placed/loaded (no provider) — an
 *  unhandled rejection here would blank the rail permanently. */
export async function getThemes(): Promise<ThemesResult> {
    try {
        const result = await mmgisRequest<ThemesResult>(
            'plugin:layerfilter:getThemes',
        )
        return result || { themes: [] }
    } catch {
        return { themes: [] }
    }
}
