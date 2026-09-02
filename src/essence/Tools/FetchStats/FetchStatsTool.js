/**
 * FetchStats plugin — no-UI background plugin.
 *
 * pluginId: 'fetch-stats' — declared in this plugin's config.json. The tool
 * controller mints the plugin-scoped bus handle from it and injects it as
 * `FetchStatsTool.api` before make() runs, which is what prefixes the emits
 * below with `plugin:fetch-stats:`.
 *
 * Listens to:
 *   - plugin:aoi:analysisAOIReady   { feature }
 *
 * Emits (auto-prefixed plugin:fetch-stats:):
 *   - analysisProgress   { done: number, total: number }
 *   - analysisReady      { analysisData: { [layerDisplayName]: <stats response | null> } }
 *   - analysisSkipped    { reason: 'no-eligible-layers' }
 *                        Fires when an analysisAOIReady arrives but no
 *                        visible layer has `variables.analysis.is_analysis_supported`.
 *                        Consumers can surface a "toggle on an analysis layer"
 *                        message to the user.
 */

/**
 * Build the statistics POST URL for a layer's `variables.analysis` block.
 * `assets` and `bidx` repeat; `nodata` is set when present.
 */
function buildStatsUrl(analysis) {
    const params = new URLSearchParams()
    for (const asset of analysis.assets || []) params.append('assets', asset)
    for (const b of analysis.bidx || []) params.append('bidx', String(b))
    if (analysis.nodata != null) params.set('nodata', String(analysis.nodata))
    const qs = params.toString()
    return `${analysis.itemUrl}/statistics${qs ? `?${qs}` : ''}`
}

const FetchStatsTool = {
    height: 0,
    width: 0,
    MMGISInterface: null,
    _api: null,
    _cleanups: [],

    // No initialize(): the controller calls make() on every load, and a
    // make() that ran twice would subscribe twice and answer one AOI
    // selection with two analysis runs.
    make(targetId) {
        this.MMGISInterface = new interfaceWithMMGIS(this, targetId)
        // The controller minted this tool's bus handle before make() ran. The
        // stand-in mirrors the handle's shape so environments that mount the
        // tool without one do not crash. Releasing the handle belongs to the
        // controller, not to destroy().
        this._api = FetchStatsTool.api || {
            emit: () => {},
            provide: () => () => {},
            request: () => Promise.resolve(undefined),
            getVars: () => ({}),
            release: () => {},
        }

        const api = window.mmgisAPI
        if (api?.on) {
            const subscribe = (event, handler) => {
                const off = api.on(event, handler)
                this._cleanups.push(typeof off === 'function' ? off : () => {})
            }
            subscribe('plugin:aoi:analysisAOIReady', (e) => {
                this._runAnalysisForVisibleLayers(e?.feature).catch((err) =>
                    console.warn('[FetchStats] analysis run failed', err)
                )
            })
        }
    },

    destroy() {
        this._cleanups.forEach((fn) => fn())
        this._cleanups = []
        this.MMGISInterface?.separateFromMMGIS()
        // A run already in flight is awaiting its network calls and cannot be
        // cancelled, so dropping the handle is what keeps its remaining
        // progress and result emits from reaching the bus after the plugin is
        // gone. The emits below are guarded for exactly this.
        this._api = null
    },

    async _getAnalyzableVisibleLayers() {
        const bus = window.mmgisAPI
        const [visibleMap, allUuids] = await Promise.all([
            bus.request('layers:getVisible'),
            bus.request('layers:getAll'),
        ])
        const visibleSet = new Set(
            Object.entries(visibleMap || {})
                .filter(([, v]) => v)
                .map(([k]) => k)
        )
        const candidateUuids = (allUuids || []).filter((id) => visibleSet.has(id))
        const configs = await Promise.all(
            candidateUuids.map((uuid) => bus.request('layers:getConfig', uuid))
        )
        return configs.filter((l) => l?.variables?.analysis?.is_analysis_supported)
    },

    async _runAnalysisForVisibleLayers(feature) {
        if (!feature?.geometry || !window.mmgisAPI?.request) return

        const layers = await this._getAnalyzableVisibleLayers()
        if (!layers.length) {
            this._api?.emit('analysisSkipped', { reason: 'no-eligible-layers' })
            return
        }

        this._api?.emit('analysisProgress', { done: 0, total: layers.length })

        const body = JSON.stringify({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {},
        })

        let done = 0
        const entries = await Promise.all(
            layers.map(async (layer) => {
                const displayName = layer.display_name || layer.name
                const result = await this._postStatsForLayer(layer, body)
                done += 1
                this._api?.emit('analysisProgress', { done, total: layers.length })
                return [displayName, result]
            })
        )

        const analysisData = Object.fromEntries(entries)
        this._api?.emit('analysisReady', { analysisData })
    },

    async _postStatsForLayer(layer, body) {
        const analysis = layer.variables.analysis
        const displayName = layer.display_name || layer.name
        if (!analysis?.itemUrl) {
            console.warn(`[FetchStats] ${displayName}: missing analysis.itemUrl`)
            return null
        }
        try {
            const resp = await fetch(buildStatsUrl(analysis), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                credentials: 'include',
            })
            if (!resp.ok) {
                console.info(`[FetchStats] ${displayName}: no data for this AOI (HTTP ${resp.status})`)
                return null
            }
            return await resp.json()
        } catch (err) {
            console.warn(`[FetchStats] ${displayName}: stats fetch failed`, err)
            return null
        }
    },
}

function interfaceWithMMGIS(tool, targetId) {
    this.separateFromMMGIS = function () {}
}

export default FetchStatsTool
