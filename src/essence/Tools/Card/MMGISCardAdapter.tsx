import React from 'react'
import { useState, useCallback } from 'react'
import { CardList } from './lib'
import type { CardItem } from './lib/types'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { getCardData } from './adapters/getCardData'

export function MMGISCardAdapter() {
    const [cards, setCards] = useState<CardItem[]>([])
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        try {
            setCards(await getCardData())
        } catch (err) {
            console.error('Card: refresh failed', err)
            setCards([])
        } finally {
            setLoading(false)
        }
    }, [])

    // 'tool:getVars' is registered by Layers_.fina() during mission load. Wait
    // for it before the initial fetch, otherwise the adapter mounts to an empty
    // list and never recovers (no event fires when vars first become available).
    useMMGISHandlerReady('tool:getVars', refresh)

    return <CardList cards={cards} loading={loading} />
}
