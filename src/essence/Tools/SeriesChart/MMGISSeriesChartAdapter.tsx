import React, { useCallback, useEffect, useState } from 'react'
import { SeriesChartPanel } from './lib'
import type { CardState, ChartLayout } from './lib'
import { mmgisOn, mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    seriesEvents,
    isChartSeriesPayload,
} from '../_shared/types/chartSeries'

const PLUGIN_ID = 'serieschart'

/**
 * Fetcher plugin ids the chart listens to by default. Overridable via the
 * tool's `sources` variable — that config entry is how an app builder wires
 * a new fetcher plugin into this chart without code changes.
 */
const DEFAULT_SOURCES = ['fetch-timeseries']

function chartIdOf(payload: unknown): string | null {
    const id = (payload as { chartId?: unknown } | null)?.chartId
    return typeof id === 'string' && id !== '' ? id : null
}

/**
 * Bridges the bus to the presentational panel: subscribes to each source
 * plugin's series events and keeps one card per chartId. All payloads are
 * treated as untrusted (other plugins emit them) — malformed ones warn and
 * are dropped rather than crashing the panel.
 */
export function MMGISSeriesChartAdapter() {
    const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES)
    const [layout, setLayout] = useState<ChartLayout>('single')
    const [cards, setCards] = useState<Record<string, CardState>>({})

    const refresh = useCallback(async () => {
        try {
            const vars = await mmgisRequest<{
                sources?: unknown
                layout?: unknown
            }>('tool:getVars', PLUGIN_ID)
            // A configured array wins even when empty — an explicitly-empty
            // list means "listen to nothing"; only an unset config keeps the
            // built-in default.
            if (Array.isArray(vars?.sources)) {
                setSources(
                    vars.sources.filter(
                        (s): s is string => typeof s === 'string' && s !== '',
                    ),
                )
            }
            if (vars?.layout === 'single' || vars?.layout === 'stacked')
                setLayout(vars.layout)
        } catch (err) {
            console.warn('[SeriesChart] tool:getVars unavailable:', err)
        }
    }, [])
    // Registered by Layers_.fina() during mission load; wait so the initial
    // read doesn't silently return null and stick with defaults forever.
    useMMGISHandlerReady('tool:getVars', refresh)

    useEffect(() => {
        const offs = sources.flatMap((sourceId) => {
            const events = seriesEvents(sourceId)
            return [
                mmgisOn(events.loading, (p) => {
                    const chartId = chartIdOf(p)
                    if (!chartId) return
                    const title = (p as { title?: unknown }).title
                    setCards((prev) => ({
                        ...prev,
                        [chartId]: {
                            status: 'loading',
                            title:
                                typeof title === 'string'
                                    ? title
                                    : titleOf(prev[chartId]),
                        },
                    }))
                }),
                mmgisOn(events.ready, (p) => {
                    // Flat like the other three messages: the event payload
                    // IS the ChartSeriesPayload, no envelope.
                    if (!isChartSeriesPayload(p)) {
                        console.warn(
                            `[SeriesChart] dropped malformed seriesReady from '${sourceId}'`,
                            p,
                        )
                        return
                    }
                    setCards((prev) => ({
                        ...prev,
                        [p.chartId]: { status: 'ready', payload: p },
                    }))
                }),
                mmgisOn(events.error, (p) => {
                    const chartId = chartIdOf(p)
                    if (!chartId) return
                    const message = (p as { message?: unknown }).message
                    setCards((prev) => ({
                        ...prev,
                        [chartId]: {
                            status: 'error',
                            title: titleOf(prev[chartId]),
                            message:
                                typeof message === 'string' && message !== ''
                                    ? message
                                    : 'Could not load data.',
                        },
                    }))
                }),
                mmgisOn(events.cleared, (p) => {
                    const chartId = chartIdOf(p)
                    if (!chartId) return
                    setCards((prev) => {
                        if (!(chartId in prev)) return prev
                        const next = { ...prev }
                        delete next[chartId]
                        return next
                    })
                }),
            ]
        })
        return () => offs.forEach((off) => off())
    }, [sources])

    const cardList = Object.entries(cards).map(([chartId, state]) => ({
        chartId,
        state,
    }))
    return <SeriesChartPanel cards={cardList} layout={layout} />
}

function titleOf(state: CardState | undefined): string | undefined {
    if (!state) return undefined
    if (state.status === 'ready') return state.payload.title
    return state.title
}
