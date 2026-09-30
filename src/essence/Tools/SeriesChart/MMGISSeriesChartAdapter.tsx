import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SeriesChartPanel } from './lib'
import type { ChartLayout } from './lib'
import {
    mmgisHidePlugin,
    mmgisOn,
    mmgisRequest,
    mmgisShowPlugin,
    type CommandResult,
} from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    seriesEvents,
    isChartSeriesPayload,
    type ChartSeriesPayload,
} from '../_shared/types/chartSeries'

const PLUGIN_ID = 'serieschart'
/** The id the layout knows this tool by, for show and hide. */
const TOOL_ID = 'SeriesChartTool'

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

/** The tool starts hidden (config metadata) and is on screen only while it
 *  has something to show. Asking for a state the tool already holds is a
 *  no-op in the layout, so every chart may ask to be seen: a panel hidden
 *  meanwhile comes back with the new data instead of updating unseen. No
 *  layout means nothing to show or hide, not a failure. */
function setShown(shown: boolean) {
    const command = shown ? mmgisShowPlugin : mmgisHidePlugin
    command(TOOL_ID)
        .then((result: CommandResult) => {
            if (result.ok === true) return
            if (result.reason === 'layout-inactive') return
            console.warn(
                `[SeriesChart] ${shown ? 'show' : 'hide'} refused: ${result.reason}`,
            )
        })
        .catch((err) => console.warn('[SeriesChart] show/hide failed:', err))
}

/**
 * Bridges the bus to the presentational panel: subscribes to each source
 * plugin's `seriesReady` and `seriesCleared` and keeps one card per chartId.
 * Loading and failure are the fetcher's to show on its own surface. All
 * payloads are treated as untrusted (other plugins emit them) — malformed
 * ones warn and are dropped rather than crashing the panel.
 */
export function MMGISSeriesChartAdapter() {
    const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES)
    const [layout, setLayout] = useState<ChartLayout>('dropdown')
    const [cards, setCards] = useState<Record<string, ChartSeriesPayload>>({})
    // The live card map; state is a snapshot of it, so the handlers can
    // decide about show and hide without a side effect inside an updater.
    const cardsRef = useRef<Record<string, ChartSeriesPayload>>({})

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
            if (vars?.layout === 'dropdown' || vars?.layout === 'list')
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
                mmgisOn(events.ready, (p) => {
                    // Flat like seriesCleared: the event payload IS the
                    // ChartSeriesPayload, no envelope.
                    if (!isChartSeriesPayload(p)) {
                        console.warn(
                            `[SeriesChart] dropped malformed seriesReady from '${sourceId}'`,
                            p,
                        )
                        return
                    }
                    cardsRef.current = { ...cardsRef.current, [p.chartId]: p }
                    setCards(cardsRef.current)
                    setShown(true)
                }),
                mmgisOn(events.cleared, (p) => {
                    const chartId = chartIdOf(p)
                    if (!chartId || !(chartId in cardsRef.current)) return
                    const next = { ...cardsRef.current }
                    delete next[chartId]
                    cardsRef.current = next
                    setCards(next)
                    if (Object.keys(next).length === 0) setShown(false)
                }),
            ]
        })
        return () => offs.forEach((off) => off())
    }, [sources])

    const cardList = Object.entries(cards).map(([chartId, payload]) => ({
        chartId,
        payload,
    }))

    return <SeriesChartPanel cards={cardList} layout={layout} />
}
