/**
 * FetchTimeseries plugin — a small card holding the date range, over the
 * fetch that charts a vector feature's time series.
 *
 * pluginId: 'fetch-timeseries'
 *
 * Listens to:
 *   - plugin:fetch-timeseries:fetch   { feature, layerId, latlng }
 *     A request to chart one feature. The Feature Popup emits it when a
 *     layer's card declares an action with this event name; any other
 *     plugin or engine may emit the same message.
 *
 * Emits (consumed by SeriesChart via the shared contract in
 * _shared/types/chartSeries.ts):
 *   - plugin:fetch-timeseries:seriesReady    ChartSeriesPayload
 *   - plugin:fetch-timeseries:seriesCleared  { chartId } (on destroy)
 *
 * Loading and failure show on this tool's own card, so neither is an event.
 *
 * 'fetch-timeseries' is the kebab-case plugin id used in event names (the
 * convention the chart-series contract adopts, like FetchStats); it is
 * distinct from the core tool name 'FetchTimeseries'.
 *
 * A layer opts in via `variables.timeseries` (see lib/timeseries.ts). A
 * request for a feature of a layer without that block does nothing. The
 * card appears with the first request and stays: changing a date refetches
 * the same feature over the new range, and the chart replaces its card.
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
    mmgisOn,
    mmgisEmit,
    mmgisGetLayerConfig,
    mmgisGetTimeEnd,
    mmgisGetTimeStart,
    mmgisIsTimeEnabled,
    mmgisShowPlugin,
} from '../_shared/adapters/mmgisAPI'
import { seriesEvents } from '../_shared/types/chartSeries'
import {
    getTimeseriesConfig,
    templateUrl,
    withDateRange,
    featureTitle,
    buildPayload,
    TemplateError,
    MappingError,
    type FeatureLike,
    type TimeseriesConfig,
} from './lib/timeseries'
import { RangeCard, type RangeStatus } from './lib/components/RangeCard'
import './lib/styles/range-card.scss'

const PLUGIN_ID = 'fetch-timeseries'
/** The id the layout knows this tool by, for show. */
const TOOL_ID = 'FetchTimeseriesTool'
const CHART_ID = 'vector-timeseries'
const EVENTS = seriesEvents(PLUGIN_ID)
const FETCH_EVENT = `plugin:${PLUGIN_ID}:fetch`
/** A stalled connection must not strand the card's spinner — the only other
 *  way out of a hung fetch is the user requesting another feature. */
const FETCH_TIMEOUT_MS = 30000
const DAY_MS = 24 * 60 * 60 * 1000
/** Without a mission time window, the range defaults to the past year. */
const DEFAULT_SPAN_DAYS = 365

interface FetchRequest {
    feature?: FeatureLike | null
    layerId?: string | null
    latlng?: { lat: number; lng: number } | null
}

/** What the last request resolved to, kept so a date change can refetch it. */
interface Selection {
    feature: FeatureLike
    layerName: string
    latlng: { lat: number; lng: number } | null | undefined
    config: TimeseriesConfig
    title: string
    layerDisplayName: string
}

interface DateRange {
    start: string
    end: string
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

const FetchTimeseriesTool = {
    height: 0,
    width: 0,
    made: false,
    _cleanups: [] as Array<() => void>,
    _abort: null as AbortController | null,
    _root: null as Root | null,
    _selection: null as Selection | null,
    _range: null as DateRange | null,
    _status: { kind: 'idle' } as RangeStatus,

    initialize() {
        this.make()
    },

    /** Subscribes once; mounts the card when the layout hands over a
     *  container. The controller may call this twice, with and without one. */
    make(targetId?: unknown) {
        if (!this.made) {
            this._cleanups.push(
                mmgisOn(FETCH_EVENT, (payload) => {
                    // The handler is async; an unexpected throw must surface as
                    // a logged warning, never an unhandled rejection.
                    this._onFetch(payload as FetchRequest).catch((err) =>
                        console.warn('[FetchTimeseries] fetch request failed', err),
                    )
                }),
            )
            this.made = true
        }
        const container =
            typeof targetId === 'string' ? document.getElementById(targetId) : null
        if (container && !this._root) {
            this._root = createRoot(container)
            this._render()
        }
    },

    destroy() {
        this._abort?.abort()
        this._abort = null
        this._cleanups.forEach((off) => off())
        this._cleanups = []
        this._root?.unmount()
        this._root = null
        this._selection = null
        this._range = null
        this._status = { kind: 'idle' }
        // The data source is going away: remove its card rather than strand
        // a stale chart.
        if (this.made) mmgisEmit(EVENTS.cleared, { chartId: CHART_ID })
        this.made = false
    },

    getUrlString() {
        return ''
    },

    _render() {
        if (!this._root) return
        const range = this._range
        this._root.render(
            <RangeCard
                title={this._selection?.title}
                subtitle={this._selection?.layerDisplayName}
                start={range?.start ?? ''}
                end={range?.end ?? ''}
                status={this._status}
                onRangeChange={(start, end) => this._onRangeChange(start, end)}
            />,
        )
    },

    _setStatus(status: RangeStatus) {
        this._status = status
        this._render()
    },

    /** The mission's time window when the mission has one, else the past
     *  year. Read once; the viewer owns the range after that. */
    async _ensureRange(): Promise<DateRange> {
        if (this._range) return this._range
        let range: DateRange | null = null
        if ((await mmgisIsTimeEnabled()) === true) {
            const [start, end] = await Promise.all([mmgisGetTimeStart(), mmgisGetTimeEnd()])
            const s = start ? new Date(start) : null
            const e = end ? new Date(end) : null
            if (s && e && !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e) {
                range = { start: isoDay(s), end: isoDay(e) }
            }
        }
        if (!range) {
            const now = new Date()
            range = {
                start: isoDay(new Date(now.getTime() - DEFAULT_SPAN_DAYS * DAY_MS)),
                end: isoDay(now),
            }
        }
        this._range = range
        return range
    },

    _onRangeChange(start: string, end: string) {
        this._range = { start, end }
        this._render()
        if (this._selection) {
            this._fetchFor(this._selection).catch((err) =>
                console.warn('[FetchTimeseries] refetch failed', err),
            )
        }
    },

    async _onFetch(payload?: FetchRequest) {
        const feature = payload?.feature
        const layerName = payload?.layerId
        if (feature == null || layerName == null) return

        // hasHandler-guarded: during mission load/reload the provider isn't
        // registered yet and this resolves null — the request is a no-op.
        const layerConfig = await mmgisGetLayerConfig(layerName)
        const config = getTimeseriesConfig(layerConfig)
        // Layers without a timeseries block do nothing — no fetch, no card,
        // no error.
        if (config == null) return

        const layerDisplayName =
            (typeof layerConfig?.display_name === 'string' &&
                layerConfig.display_name) ||
            layerName
        this._selection = {
            feature,
            layerName,
            latlng: payload?.latlng,
            config,
            title: featureTitle(feature, config, layerDisplayName),
            layerDisplayName,
        }
        await this._ensureRange()
        this._render()
        mmgisShowPlugin(TOOL_ID).catch((err) =>
            console.warn('[FetchTimeseries] show failed:', err),
        )
        await this._fetchFor(this._selection)
    },

    async _fetchFor(selection: Selection) {
        const { feature, layerName, latlng, config, title, layerDisplayName } = selection
        const range = await this._ensureRange()

        this._abort?.abort()
        const abort = new AbortController()
        this._abort = abort
        this._setStatus({ kind: 'loading' })

        let url: string
        try {
            url = withDateRange(
                templateUrl(config.url, feature, latlng),
                config.xKey || 'datetime',
                range.start,
                range.end,
            )
        } catch (err) {
            if (err instanceof TemplateError) {
                this._setStatus({ kind: 'error', message: err.message })
                return
            }
            throw err
        }

        // The timeout aborts the same controller a superseding request would;
        // the flag is what tells the two apart in the catch below.
        let timedOut = false
        const timer = window.setTimeout(() => {
            timedOut = true
            abort.abort()
        }, FETCH_TIMEOUT_MS)
        try {
            // Prefer GeoJSON: content-negotiating APIs (tipg) serve flat rows
            // for bare application/json; servers that don't negotiate ignore
            // the extra types.
            const resp = await fetch(url, {
                signal: abort.signal,
                headers: {
                    Accept: 'application/geo+json, application/json;q=0.9, */*;q=0.8',
                },
            })
            if (abort.signal.aborted && !timedOut) return
            if (!resp.ok) {
                this._setStatus({
                    kind: 'error',
                    message: `Could not load data (HTTP ${resp.status})`,
                })
                return
            }
            const body: unknown = await resp.json()
            if (abort.signal.aborted && !timedOut) return
            const chartPayload = buildPayload({
                chartId: CHART_ID,
                response: body,
                config,
                title,
                layerDisplayName,
                layerName,
                featureId: feature.id,
            })
            this._setStatus({ kind: 'idle' })
            mmgisEmit(EVENTS.ready, chartPayload)
        } catch (err) {
            // Superseded or torn down — silent; a timeout abort must speak.
            if (abort.signal.aborted && !timedOut) return
            const message =
                err instanceof MappingError
                    ? err.message
                    : timedOut
                      ? 'Request timed out'
                      : 'Could not load data for this feature'
            if (!(err instanceof MappingError)) {
                console.warn('[FetchTimeseries] fetch failed', err)
            }
            this._setStatus({ kind: 'error', message })
        } finally {
            window.clearTimeout(timer)
        }
    },
}

export default FetchTimeseriesTool
