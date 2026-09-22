import { test, expect, vi } from 'vitest'
import {
    toggleVisibility,
    getFilteredOutLayers,
    hideFilteredOutLayers,
    applyRun,
    selectRun,
    ensureRunSelected,
    setOpacity,
    setColormap,
    setRescale,
    zoomToLayer,
    compareLayer,
    showAddLayer,
    dropLayer,
} from '../adapters/handlers.ts'
import { clearForecastRunsCache } from '../adapters/forecastRuns.ts'
import {
    ZOOM_TO_LAYER_PADDING,
    ZOOM_TO_LAYER_POINT_MAX_ZOOM,
} from '../lib/utils/constants.ts'

const setupMock = (responses = {}, emitCalls = []) => {
    global.window = global.window || {}
    const requests = []
    global.window.mmgisAPI = {
        request: async (name, params) => {
            requests.push({ name, params })
            if (responses[name] !== undefined) {
                return typeof responses[name] === 'function' ? responses[name](params) : responses[name]
            }
            return null
        },
        hasHandler: (name) => responses[name] !== undefined,
        on: () => () => {},
        emit: (event, payload) => { emitCalls.push({ event, payload }) },
    }
    return { emitCalls, requests }
}

// showAddLayer fires its request without returning it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const EDITABLE = { hasColormap: true, canChangeColormap: true }
// What an image layer reports: a ramp to show, but nothing to change.
const READ_ONLY = { hasColormap: true, canChangeColormap: false }

// Core answers the capability handler per layer, resolving the identifier it
// is given; unknown layers get null.
const capabilities = (byLayer) => (layerId) => byLayer[layerId] ?? null

const COG_LAYER = {
    'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
    'layers:updateConfig': true,
    'layers:refresh': true,
}

test.describe('handlers', () => {
    test('toggleVisibility issues layers:toggle and emits visibilityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:toggle': true })
        await toggleVisibility('layerA')
        expect(emitCalls).toContainEqual({
            event: 'layer:visibilityChange',
            payload: { layerName: 'layerA', visible: true },
        })
    })

    test('getFilteredOutLayers names the layers on the map but filtered out of the list', async () => {
        setupMock({
            'layers:getVisible': { a: true, b: true, c: false, d: true },
            'layers:getListed': { b: false, c: false, d: false },
            'layers:getAllConfigs': { a: { display_name: 'A' }, b: { display_name: 'Bravo' }, d: {} },
        })
        expect(await getFilteredOutLayers()).toEqual([
            { id: 'b', title: 'Bravo' },
            { id: 'd', title: 'd' },
        ])
    })

    test('hideFilteredOutLayers toggles only those layers and emits for each', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getVisible': { a: true, b: true, c: false, d: true },
            'layers:getListed': { b: false, c: false, d: false },
            'layers:getAllConfigs': {},
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()

        const toggled = requests.filter((r) => r.name === 'layers:toggle').map((r) => r.params)
        expect(toggled).toEqual(['b', 'd'])
        expect(emitCalls).toEqual([
            { event: 'layer:visibilityChange', payload: { layerName: 'b', visible: false } },
            { event: 'layer:visibilityChange', payload: { layerName: 'd', visible: false } },
        ])
    })

    test('hideFilteredOutLayers sends nothing when no layer is filtered out', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getVisible': { a: true, b: false },
            'layers:getListed': { b: false },
            'layers:getAllConfigs': {},
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()

        expect(requests.some((r) => r.name === 'layers:toggle')).toBe(false)
        expect(emitCalls).toEqual([])
    })

    test('hideFilteredOutLayers is a no-op against a core without the listed handler', async () => {
        const { requests } = setupMock({
            'layers:getVisible': { a: true },
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()
        expect(requests.some((r) => r.name === 'layers:toggle')).toBe(false)
    })

    test('setOpacity issues layers:setOpacity and emits opacityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:setOpacity': true })
        await setOpacity('layerA', 0.5)
        expect(emitCalls).toContainEqual({
            event: 'layer:opacityChange',
            payload: { layerName: 'layerA', opacity: 0.5 },
        })
    })

    test('setColormap is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
    })

    // Core resolves the identifier, so the handler asks about one layer rather
    // than indexing a UUID-keyed map with whatever id the panel holds.
    test('setColormap asks core about the layer it is changing', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        expect(requests[0]).toEqual({
            name: 'layers:getCogCapabilities',
            params: 'layerA',
        })
    })

    // Without the handler there is no way to know core can repaint the layer,
    // so the write is withheld rather than sent and silently dropped.
    test('setColormap is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerA', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    test('setColormap calls refresh on success', async () => {
        const { emitCalls } = setupMock(COG_LAYER)
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogColormapChange',
            payload: { layerName: 'layerA', colormap: 'plasma' },
        })
        expect(refreshCalled).toBe(true)
    })

    // applyCogFieldsToUrl prefers `currentCogColormap`, so a `cogColormap`
    // override would lose to the value the config write puts there.
    test('setColormap writes and refreshes on the same currentCogColormap field', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogColormap: 'plasma' },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogColormap: 'plasma' },
        })
    })

    test('setRescale writes and refreshes on the same currentCogMin/Max fields', async () => {
        const { requests, emitCalls } = setupMock(COG_LAYER)
        await setRescale('layerA', 0, 5, () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogRescaleChange',
            payload: { layerName: 'layerA', min: 0, max: 5 },
        })
    })

    test('setRescale is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setRescale('layerA', 0, 5, () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })

    test('setRescale is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setRescale('layerA', 0, 5, () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    // A layer core has never heard of answers null, which must read as
    // "cannot change" rather than throw.
    test('setColormap is a no-op for a layer core does not know', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerB', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })

    // [[south, west], [north, east]] — the pair both map engines normalise.
    const EXTENT = [
        [30, -120],
        [45, -100],
    ]

    // Every feature of the layer sitting at one point: an extent enclosing no
    // area at all.
    const POINT_EXTENT = [
        [30, -120],
        [30, -120],
    ]

    const LOCATABLE = {
        'layers:getBounds': (layerId) =>
            ({ layerA: EXTENT, layerPoint: POINT_EXTENT }[layerId] ?? null),
        'map:fitBounds': true,
    }

    test('zoomToLayer fits the map to the extent core reports', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerA')

        expect(requests).toEqual([
            { name: 'layers:getBounds', params: 'layerA' },
            {
                name: 'map:fitBounds',
                params: {
                    bounds: EXTENT,
                    options: { padding: ZOOM_TO_LAYER_PADDING },
                },
            },
        ])
    })

    // An extent with area is fitted uncapped, so a layer covering a few hundred
    // metres reaches the detail it carries rather than stopping where a point
    // layer has to.
    test('zoomToLayer leaves an extent with area uncapped', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerA')

        const fit = requests.find((r) => r.name === 'map:fitBounds')
        expect(fit.params.options.maxZoom).toBeUndefined()
    })

    // An extent enclosing no area fits to maximum zoom without a cap, landing
    // far past any tile the layer serves.
    test('zoomToLayer caps a fit to an extent enclosing no area', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerPoint')

        const fit = requests.find((r) => r.name === 'map:fitBounds')
        expect(fit.params.options).toEqual({
            padding: ZOOM_TO_LAYER_PADDING,
            maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM,
        })
    })

    test('zoomToLayer moves nothing for a layer with no extent', async () => {
        const { requests } = setupMock(LOCATABLE)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await zoomToLayer('layerB')

        expect(requests.map((r) => r.name)).toEqual(['layers:getBounds'])
        // The panel has no channel for reporting a click that led nowhere, so
        // the log is where it has to show up.
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('layerB'))
        warn.mockRestore()
    })

    // Against a core too old to register the handler there is no extent to
    // move to, and asking the map to fit nothing would throw.
    test('zoomToLayer is a no-op against a core without the bounds handler', async () => {
        const { requests } = setupMock({ 'map:fitBounds': true })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await zoomToLayer('layerA')

        expect(requests).toHaveLength(0)
        warn.mockRestore()
    })

    test('compareLayer announces the layer on the bus', () => {
        const { emitCalls, requests } = setupMock()
        compareLayer('layerA')

        expect(emitCalls).toEqual([
            {
                event: 'plugin:comparison:startWithLayer',
                payload: { layerId: 'layerA' },
            },
        ])
        expect(requests).toHaveLength(0)
    })

    test('showAddLayer commands the layout to reveal the form', async () => {
        const { emitCalls, requests } = setupMock({
            'plugins:show': { ok: true, state: 'visible', changed: true },
        })
        showAddLayer()
        await flush()

        expect(requests).toEqual([
            { name: 'plugins:show', params: { pluginId: 'AddTempLayerTool' } },
        ])
        expect(emitCalls).toHaveLength(0)
    })

    test('showAddLayer logs a refusal instead of dropping it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        setupMock({ 'plugins:show': { ok: false, reason: 'not-found' } })
        showAddLayer()
        await flush()

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-found'))
        warn.mockRestore()
    })
})

// dropLayer reads the order from core, places the layer with the pure helper
// covered in tests/unit/layerManagerOrder.spec.js, and hands the whole list
// back. Core's broadcast is what re-sorts the list; nothing is emitted here.
test.describe('dropLayer', () => {
    const withOrder = (order, accepted = true) => {
        const writes = []
        const { emitCalls } = setupMock({
            'layers:getOrder': order,
            'layers:setOrder': (params) => {
                writes.push(params.order)
                return accepted
            },
        })
        return { writes, emitCalls }
    }

    test('writes the placed order back and emits nothing', async () => {
        const { writes, emitCalls } = withOrder(['a', 'b', 'c'])

        await dropLayer('c', 0, ['a', 'b', 'c'])

        expect(writes).toEqual([['c', 'a', 'b']])
        expect(emitCalls).toEqual([])
    })

    test('a drop onto its own slot writes nothing', async () => {
        const { requests } = setupMock({ 'layers:getOrder': ['a', 'b', 'c'] })

        await dropLayer('b', 1, ['a', 'b', 'c'])

        expect(requests.map((r) => r.name)).toEqual(['layers:getOrder'])
    })

    test('writes nothing against a core without an order', async () => {
        const { requests } = setupMock({})

        await dropLayer('a', 1, ['a', 'b'])

        expect(requests.map((r) => r.name)).not.toContain('layers:setOrder')
    })

    // Core refuses when this side's picture of the stack is stale, so the
    // refusal is the moment to re-read it.
    test('on a refusal, warns and refreshes rather than throwing', async () => {
        withOrder(['a', 'b'], false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refresh = vi.fn()

        await expect(dropLayer('b', 0, ['a', 'b'], refresh)).resolves.toBeUndefined()

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('b'))
        expect(refresh).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    test('drops a second drop that arrives before the first has been written', async () => {
        const { writes } = withOrder(['a', 'b', 'c'])

        const first = dropLayer('c', 0, ['a', 'b', 'c'])
        const second = dropLayer('c', 0, ['a', 'b', 'c'])
        await Promise.all([first, second])

        expect(writes).toEqual([['c', 'a', 'b']])
    })
})

test.describe('forecast runs', () => {
    const TILES =
        'https://svc.example/tiles/WebMercatorQuad/{z}/{x}/{y}?url=s3://bucket/o3_conus&variable=ozcon&sel=reference_time=nearest::{reftime}&sel=lead=nearest::{lead}'
    const RUNS_URL = 'https://svc.example/dataset/coordinates/reference_time?url=s3%3A%2F%2Fbucket%2Fo3_conus'
    const LEAD_URL = 'https://svc.example/dataset/coordinates/lead?url=s3%3A%2F%2Fbucket%2Fo3_conus'
    const NEWEST = '2026-09-21T12:00:00'
    const OLDER = '2026-09-21T06:00:00'
    const HOURLY = { leadStep: 'PT1H', leadRange: [1, 72] }

    const configFor = (forecast = {}, extra = {}) => ({
        fc: {
            url: TILES,
            time: { enabled: true, format: '%Y-%m-%dT%H:%M:%SZ' },
            variables: { forecast, urlReplacements: { other: { on: 'timeChange', kind: 'value', value: 'x' } } },
            ...extra,
        },
    })

    const stubCoordinates = (runs, leads) => {
        const fetch = vi.fn(async (url) => ({
            ok: true,
            json: async () => ({ data: url === RUNS_URL ? runs : url === LEAD_URL ? leads : null }),
        }))
        vi.stubGlobal('fetch', fetch)
        return fetch
    }

    const beforeEachRun = () => clearForecastRunsCache()

    test('applyRun writes the run, both replacements, and the window, then refreshes a layer that is on', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor({ runs: 5 }),
            'layers:getVisible': { fc: true },
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        expect(await applyRun('fc', OLDER, HOURLY)).toBe(true)

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        expect(update.params).toEqual({
            layerUUID: 'fc',
            updates: {
                variables: {
                    forecast: { runs: 5, selectedRun: OLDER, leadRange: [1, 72] },
                    urlReplacements: {
                        other: { on: 'timeChange', kind: 'value', value: 'x' },
                        reftime: { on: 'timeChange', kind: 'value', value: OLDER },
                        lead: { on: 'timeChange', kind: 'elapsed', from: OLDER, step: 'PT1H' },
                    },
                },
                time: {
                    enabled: true,
                    format: '%Y-%m-%dT%H:%M:%SZ',
                    dataStartTime: '2026-09-21T07:00:00Z',
                    dataEndTime: '2026-09-24T06:00:00Z',
                },
            },
        })
        expect(requests.map((r) => r.name)).toContain('layers:refresh')
    })

    test('applyRun leaves a layer that is off unrefreshed, and leaves time alone without a lead range', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:getVisible': { fc: false },
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        expect(await applyRun('fc', OLDER, { leadStep: 'PT1H', leadRange: null })).toBe(true)
        const update = requests.find((r) => r.name === 'layers:updateConfig')
        expect(update.params.updates.time).toBeUndefined()
        expect(requests.some((r) => r.name === 'layers:refresh')).toBe(false)
    })

    test('applyRun reports a layer core does not know', async () => {
        beforeEachRun()
        setupMock({ 'layers:getAllConfigs': {} })
        expect(await applyRun('nope', OLDER, HOURLY)).toBe(false)
    })

    test('selectRun leaves the clock alone when it already sits inside the run window', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:getVisible': { fc: true },
            'layers:updateConfig': true,
            'layers:refresh': true,
            'time:getCurrent': '2026-09-22T00:00:00Z',
            'time:getStart': '2020-01-01T00:00:00Z',
            'time:getEnd': '2027-01-01T00:00:00Z',
            'time:set': true,
        })
        await selectRun('fc', OLDER, HOURLY)
        expect(requests.some((r) => r.name === 'time:set')).toBe(false)
    })

    test('selectRun moves the clock to now when now is inside the run window', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:getVisible': { fc: true },
            'layers:updateConfig': true,
            'layers:refresh': true,
            'time:getCurrent': '2026-08-01T00:00:00Z',
            'time:getStart': '2020-01-01T00:00:00Z',
            'time:getEnd': '2027-01-01T00:00:00Z',
            'time:set': true,
        })
        await selectRun('fc', OLDER, HOURLY, new Date('2026-09-22T03:30:00Z'))
        const set = requests.find((r) => r.name === 'time:set')
        expect(set.params).toEqual({
            startTime: '2020-01-01T00:00:00Z',
            endTime: '2027-01-01T00:00:00Z',
            currentTime: '2026-09-22T03:30:00Z',
        })
    })

    test('selectRun moves the clock to the window start otherwise, widening the window to hold it', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:getVisible': { fc: true },
            'layers:updateConfig': true,
            'layers:refresh': true,
            'time:getCurrent': '2026-08-01T00:00:00Z',
            'time:getStart': '2026-01-01T00:00:00Z',
            'time:getEnd': '2026-09-22T00:00:00Z',
            'time:set': true,
        })
        await selectRun('fc', OLDER, HOURLY, new Date('2026-12-01T00:00:00Z'))
        const set = requests.find((r) => r.name === 'time:set')
        expect(set.params).toEqual({
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-09-24T06:00:00Z',
            currentTime: '2026-09-21T07:00:00Z',
        })
    })

    test('selectRun does nothing further when the update was refused', async () => {
        beforeEachRun()
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:updateConfig': false,
            'time:getCurrent': '2026-08-01T00:00:00Z',
            'time:set': true,
        })
        await selectRun('fc', OLDER, HOURLY)
        expect(requests.map((r) => r.name)).toEqual(['layers:getAllConfigs', 'layers:updateConfig'])
    })

    test('ensureRunSelected reads runs and leads from the service and pins the newest run', async () => {
        beforeEachRun()
        const fetch = stubCoordinates(['2026-09-20T12:00:00', OLDER, NEWEST], [1, 2, 3, 72])
        const { requests } = setupMock({
            'layers:getAllConfigs': configFor(),
            'layers:getVisible': { fc: false },
            'layers:updateConfig': true,
        })
        const forecast = { runs: [], selectedRun: null, leadStep: 'PT1H', leadRange: null, maxRuns: 2 }

        const found = await ensureRunSelected('fc', { url: TILES }, forecast)

        expect(found).toEqual({ runs: [NEWEST, OLDER], leadRange: [1, 72] })
        expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual([LEAD_URL, RUNS_URL].sort())
        const update = requests.find((r) => r.name === 'layers:updateConfig')
        expect(update.params.updates.variables.forecast.selectedRun).toBe(NEWEST)
        expect(update.params.updates.time.dataEndTime).toBe('2026-09-24T12:00:00Z')
    })

    test('ensureRunSelected leaves an existing pick alone and serves runs from cache', async () => {
        beforeEachRun()
        const fetch = stubCoordinates([OLDER, NEWEST], [1, 72])
        const { requests } = setupMock({ 'layers:getAllConfigs': configFor(), 'layers:updateConfig': true })
        const forecast = { runs: [], selectedRun: OLDER, leadStep: 'PT1H', leadRange: [1, 72], maxRuns: null }

        await ensureRunSelected('fc', { url: TILES }, forecast)
        await ensureRunSelected('fc', { url: TILES }, forecast)

        expect(fetch).toHaveBeenCalledTimes(2)
        expect(requests.some((r) => r.name === 'layers:updateConfig')).toBe(false)
    })

    test('ensureRunSelected honours runsUrl and leadUrl overrides', async () => {
        beforeEachRun()
        const fetch = vi.fn(async (url) => ({
            ok: true,
            json: async () => ({ data: url === 'https://a/runs' ? [OLDER] : [3, 4] }),
        }))
        vi.stubGlobal('fetch', fetch)
        setupMock({ 'layers:getAllConfigs': configFor(), 'layers:updateConfig': true, 'layers:getVisible': {} })
        const forecast = { runs: [], selectedRun: null, leadStep: 'P1D', leadRange: null, maxRuns: null, runsUrl: 'https://a/runs', leadUrl: 'https://a/leads' }

        const found = await ensureRunSelected('fc', { url: 'https://not-multidim/{z}' }, forecast)

        expect(found).toEqual({ runs: [OLDER], leadRange: [3, 4] })
        expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['https://a/leads', 'https://a/runs'])
    })
})
