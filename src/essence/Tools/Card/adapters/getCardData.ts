import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import { buildCardData, type RawCard } from './buildCardData'
import type { CardItem } from '../lib/types'

type CardToolVars = { cards?: RawCard[] }

// Orchestrator: pulls the configured cards (tool vars) and the mission path
// from the MMGIS event bus, then transforms them into renderable lib props.
export async function getCardData(): Promise<CardItem[]> {
    const vars =
        (await mmgisRequest<CardToolVars>('tool:getVars', 'card')) || {}
    const missionPath = await mmgisRequest<string>('app:getMissionPath')
    return buildCardData(vars.cards, typeof missionPath === 'string' ? missionPath : null)
}
