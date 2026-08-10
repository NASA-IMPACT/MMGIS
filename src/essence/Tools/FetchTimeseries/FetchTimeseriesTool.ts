/**
 * FetchTimeseries plugin — no-UI background plugin.
 *
 * pluginId: 'fetch-timeseries'
 *
 * Listens to:
 *   - feature:click   { feature, layerName, latlng, pixel }
 *
 * Emits (full names, consumed by SeriesChart via the shared contract in
 * _shared/types/chartSeries.ts):
 *   - plugin:fetch-timeseries:seriesLoading  { chartId, title }
 *   - plugin:fetch-timeseries:seriesReady    { payload: ChartSeriesPayload }
 *   - plugin:fetch-timeseries:seriesError    { chartId, message }
 *   - plugin:fetch-timeseries:seriesCleared  { chartId }
 *
 * A layer opts in via `variables.timeseries` (see lib/timeseries.ts). Clicks
 * on features of layers without that block do nothing chart-wise; a new click
 * replaces the chart (one chartId).
 */

import { mmgisOn, mmgisEmit, mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { seriesEvents } from '../_shared/types/chartSeries'
import {
    getTimeseriesConfig,
    templateUrl,
    featureTitle,
    buildPayload,
    TemplateError,
    MappingError,
    type FeatureLike,
} from './lib/timeseries'

const PLUGIN_ID = 'fetch-timeseries'
const CHART_ID = 'vector-timeseries'
const EVENTS = seriesEvents(PLUGIN_ID)

interface FeatureClickPayload {
    feature?: FeatureLike | null
    layerName?: string | null
    latlng?: { lat: number; lng: number } | null
    pixel?: { x: number; y: number } | null
}

const FetchTimeseriesTool = {
    height: 0,
    width: 0,
    made: false,
    _cleanups: [] as Array<() => void>,
    _abort: null as AbortController | null,

    initialize() {
        this.make()
    },

    make() {
        if (this.made) return
        this._cleanups.push(
            mmgisOn('feature:click', (payload) => {
                void this._onFeatureClick(payload as FeatureClickPayload)
            }),
        )
        this.made = true
    },

    destroy() {
        this._abort?.abort()
        this._abort = null
        this._cleanups.forEach((off) => off())
        this._cleanups = []
        this.made = false
    },

    getUrlString() {
        return ''
    },

    async _onFeatureClick(payload?: FeatureClickPayload) {
        const feature = payload?.feature
        const layerName = payload?.layerName
        if (feature == null || layerName == null) return

        const layerConfig = await mmgisRequest<Record<string, unknown>>(
            'layers:getConfig',
            layerName,
        )
        const config = getTimeseriesConfig(layerConfig)
        // Layers without a timeseries block do nothing — no fetch, no
        // cleared chart, no error.
        if (config == null) return

        const layerDisplayName =
            (typeof layerConfig?.display_name === 'string' &&
                layerConfig.display_name) ||
            layerName
        const title = featureTitle(feature, config, layerDisplayName)

        this._abort?.abort()
        const abort = new AbortController()
        this._abort = abort

        mmgisEmit(EVENTS.loading, { chartId: CHART_ID, title })

        let url: string
        try {
            url = templateUrl(config.url, feature)
        } catch (err) {
            if (err instanceof TemplateError) {
                mmgisEmit(EVENTS.error, { chartId: CHART_ID, message: err.message })
                return
            }
            throw err
        }

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
            if (!resp.ok) {
                mmgisEmit(EVENTS.error, {
                    chartId: CHART_ID,
                    message: `Could not load data (HTTP ${resp.status})`,
                })
                return
            }
            const body: unknown = await resp.json()
            if (abort.signal.aborted) return
            const chartPayload = buildPayload({
                chartId: CHART_ID,
                response: body,
                config,
                title,
                layerDisplayName,
                layerName,
                featureId: feature.id,
            })
            mmgisEmit(EVENTS.ready, { payload: chartPayload })
        } catch (err) {
            if (abort.signal.aborted) return // superseded or cleared — silent
            const message =
                err instanceof MappingError
                    ? err.message
                    : 'Could not load data for this feature'
            if (!(err instanceof MappingError)) {
                console.warn('[FetchTimeseries] fetch failed', err)
            }
            mmgisEmit(EVENTS.error, { chartId: CHART_ID, message })
        }
    },
}

export default FetchTimeseriesTool
