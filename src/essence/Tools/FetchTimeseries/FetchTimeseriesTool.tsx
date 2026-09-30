/**
 * FetchTimeseries plugin — a small card holding the datetime range, over
 * the fetch that charts a vector feature's time series.
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
 *   - plugin:fetch-timeseries:seriesCleared  { chartId } on EXIT, on
 *     destroy, and when a fetch fails, so a stale chart never sits under
 *     an error.
 *
 * Loading and failure show on this tool's own card, so neither is an event.
 *
 * 'fetch-timeseries' is the kebab-case plugin id used in event names (the
 * convention the chart-series contract adopts, like FetchStats); it is
 * distinct from the core tool name 'FetchTimeseries'.
 *
 * A layer opts in via `variables.timeseries` (see lib/timeseries.ts). A
 * request for a feature of a layer without that block does nothing. The
 * card appears with the first request and stays: changing the range
 * refetches the same feature, and the chart replaces its card. The range
 * reaches the service through `{start}`/`{end}` in the layer's URL.
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
    mmgisOn,
    mmgisEmit,
    mmgisGetLayerConfig,
    mmgisGetLayerTemporalExtent,
    mmgisHidePlugin,
    mmgisGetTimeEnd,
    mmgisGetTimeStart,
    mmgisIsTimeEnabled,
    mmgisShowPlugin,
    type CommandResult,
} from '../_shared/adapters/mmgisAPI'
import { seriesEvents } from '../_shared/types/chartSeries'
import {
    getTimeseriesConfig,
    templateUrl,
    featureTitle,
    buildPayload,
    seedRange,
    pageInfo,
    mergePages,
    TemplateError,
    MappingError,
    type DateRange,
    type FeatureLike,
    type TimeseriesConfig,
} from './lib/timeseries'
import { RangeCard, type RangeStatus } from './lib/components/RangeCard'
import './lib/styles/range-card.scss'

const PLUGIN_ID = 'fetch-timeseries'
/** The id the layout knows this tool by, for show and hide. */
const TOOL_ID = 'FetchTimeseriesTool'
const CHART_ID = 'vector-timeseries'
const EVENTS = seriesEvents(PLUGIN_ID)
const FETCH_EVENT = `plugin:${PLUGIN_ID}:fetch`
/** A stalled connection must not strand the card's spinner — the only other
 *  way out of a hung fetch is the user requesting another feature. */
const FETCH_TIMEOUT_MS = 30000
/** A paged answer is walked page by page; past this many the range is too
 *  wide to chart, and a silently truncated series would mislead. */
const MAX_PAGES = 100
const ACCEPT = 'application/geo+json, application/json;q=0.9, */*;q=0.8'

class HttpError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`)
    }
}
/** Typing a date fires several changes; the card updates at once, the
 *  refetch waits for the typing to settle. */
const REFETCH_DEBOUNCE_MS = 400

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

const FetchTimeseriesTool = {
    height: 0,
    width: 0,
    made: false,
    _cleanups: [] as Array<() => void>,
    _abort: null as AbortController | null,
    _root: null as Root | null,
    _selection: null as Selection | null,
    _range: null as DateRange | null,
    /** The layer the range was seeded for; a pick on another layer reseeds. */
    _rangeLayer: null as string | null,
    _refetchTimer: null as number | null,
    /** Bumped per fetch request, and by destroy and EXIT: a lookup that
     *  finishes after a newer request started, or after the card was torn
     *  down or closed, must not become the selection. */
    _fetchSeq: 0,
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
        this._fetchSeq++
        this._cancelRefetch()
        this._abort?.abort()
        this._abort = null
        this._cleanups.forEach((off) => off())
        this._cleanups = []
        this._root?.unmount()
        this._root = null
        this._selection = null
        this._range = null
        this._rangeLayer = null
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
                start={range?.start ?? ''}
                end={range?.end ?? ''}
                status={this._status}
                onRangeChange={(start, end) => this._onRangeChange(start, end)}
                onExit={() => this._onExit()}
            />,
        )
    },

    _setStatus(status: RangeStatus) {
        this._status = status
        this._render()
    },

    /** The layer's own data range, its last year when longer, else the
     *  mission window, else the past year; a future end is capped at today.
     *  Seeded once per layer: the viewer owns the range after that, until a
     *  feature on another layer is picked. */
    async _ensureRange(layerName: string): Promise<DateRange> {
        if (this._range && this._rangeLayer === layerName) return this._range
        const extent = await mmgisGetLayerTemporalExtent(layerName)
        let window: { start: string | null; end: string | null } | null = null
        if ((await mmgisIsTimeEnabled()) === true) {
            const [start, end] = await Promise.all([mmgisGetTimeStart(), mmgisGetTimeEnd()])
            window = { start, end }
        }
        this._range = seedRange({ extent, window, now: new Date() })
        this._rangeLayer = layerName
        return this._range
    },

    /** EXIT closes both surfaces: the chart hears `seriesCleared` and takes
     *  itself down, this card hides. The bus subscription stays, so the next
     *  Timeseries press opens everything again. */
    _onExit() {
        this._fetchSeq++
        this._cancelRefetch()
        this._abort?.abort()
        this._abort = null
        this._selection = null
        this._setStatus({ kind: 'idle' })
        mmgisEmit(EVENTS.cleared, { chartId: CHART_ID })
        mmgisHidePlugin(TOOL_ID)
            .then((result) => this._warnIfRefused('hide', result))
            .catch((err) => console.warn('[FetchTimeseries] hide failed:', err))
    },

    /** A refusal resolves as { ok: false, reason }, it does not reject. No
     *  layout means nothing to show or hide, not a failure. */
    _warnIfRefused(verb: 'show' | 'hide', result: CommandResult) {
        if (result.ok === true) return
        if (result.reason === 'layout-inactive') return
        console.warn(`[FetchTimeseries] ${verb} refused: ${result.reason}`)
    },

    /** Every failure shows on the card and takes the previous chart down:
     *  a narrowed range with no data, or a station that 502s, must not leave
     *  the last station's chart under the error. */
    _fail(message: string) {
        this._setStatus({ kind: 'error', message })
        mmgisEmit(EVENTS.cleared, { chartId: CHART_ID })
    },

    _onRangeChange(start: string, end: string) {
        this._range = { start, end }
        this._render()
        if (!this._selection) return
        this._cancelRefetch()
        this._refetchTimer = window.setTimeout(() => {
            this._refetchTimer = null
            if (!this._selection) return
            this._fetchFor(this._selection).catch((err) =>
                console.warn('[FetchTimeseries] refetch failed', err),
            )
        }, REFETCH_DEBOUNCE_MS)
    },

    _cancelRefetch() {
        if (this._refetchTimer == null) return
        window.clearTimeout(this._refetchTimer)
        this._refetchTimer = null
    },

    async _onFetch(payload?: FetchRequest) {
        const feature = payload?.feature
        const layerName = payload?.layerId
        if (feature == null || layerName == null) return

        const seq = ++this._fetchSeq
        // hasHandler-guarded: during mission load/reload the provider isn't
        // registered yet and this resolves null — the request is a no-op.
        const layerConfig = await mmgisGetLayerConfig(layerName)
        if (seq !== this._fetchSeq) return
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
        await this._ensureRange(layerName)
        if (seq !== this._fetchSeq) return
        this._render()
        mmgisShowPlugin(TOOL_ID)
            .then((result) => this._warnIfRefused('show', result))
            .catch((err) => console.warn('[FetchTimeseries] show failed:', err))
        await this._fetchFor(this._selection)
    },

    async _fetchFor(selection: Selection) {
        const { feature, layerName, latlng, config, title, layerDisplayName } = selection
        const range = await this._ensureRange(layerName)

        this._abort?.abort()
        const abort = new AbortController()
        this._abort = abort
        this._setStatus({ kind: 'loading' })

        let url: string
        try {
            url = templateUrl(config.url, feature, latlng, range)
        } catch (err) {
            if (err instanceof TemplateError) {
                this._fail(err.message)
                return
            }
            throw err
        }

        // The timeout aborts the same controller a superseding request would;
        // the flag is what tells the two apart in the catch below. It guards
        // a stalled connection, so it is re-armed for every page.
        let timedOut = false
        let timer = 0
        const getPage = async (pageUrl: string): Promise<unknown> => {
            window.clearTimeout(timer)
            timer = window.setTimeout(() => {
                timedOut = true
                abort.abort()
            }, FETCH_TIMEOUT_MS)
            // Prefer GeoJSON: content-negotiating APIs (tipg) serve flat rows
            // for bare application/json; servers that don't negotiate ignore
            // the extra types.
            const resp = await fetch(pageUrl, {
                signal: abort.signal,
                headers: { Accept: ACCEPT },
            })
            if (!resp.ok) throw new HttpError(resp.status)
            return resp.json()
        }
        try {
            const first = await getPage(url)
            if (abort.signal.aborted && !timedOut) return

            // OGC Features pages the answer: follow `next` until it is gone
            // or the rows gathered reach numberMatched, whichever first.
            const pageSize = pageInfo(first).returned
            const rest: unknown[] = []
            let info = pageInfo(first)
            let gathered = info.returned ?? 0
            let fetched = url
            while (
                info.next &&
                info.next !== fetched &&
                (info.matched == null || gathered < info.matched)
            ) {
                if (rest.length + 1 >= MAX_PAGES) {
                    this._fail(`More than ${MAX_PAGES} pages of data; narrow the range`)
                    return
                }
                const pages =
                    info.matched != null && pageSize ? Math.ceil(info.matched / pageSize) : null
                this._setStatus({ kind: 'loading', page: rest.length + 2, pages })
                fetched = info.next
                const page = await getPage(fetched)
                if (abort.signal.aborted && !timedOut) return
                rest.push(page)
                info = pageInfo(page)
                gathered += info.returned ?? 0
            }

            const chartPayload = buildPayload({
                chartId: CHART_ID,
                response: mergePages(first, rest, config),
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
                    : err instanceof HttpError
                      ? `Could not load data (HTTP ${err.status})`
                      : timedOut
                        ? 'Request timed out'
                        : 'Could not load data for this feature'
            if (!(err instanceof MappingError) && !(err instanceof HttpError)) {
                console.warn('[FetchTimeseries] fetch failed', err)
            }
            this._fail(message)
        } finally {
            window.clearTimeout(timer)
        }
    },
}

export default FetchTimeseriesTool
