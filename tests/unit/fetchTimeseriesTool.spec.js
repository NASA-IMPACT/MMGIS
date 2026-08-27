import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import FetchTimeseriesTool from '../../src/essence/Tools/FetchTimeseries/FetchTimeseriesTool'
import { isChartSeriesPayload } from '../../src/essence/Tools/_shared/types/chartSeries'

const LOADING = 'plugin:fetch-timeseries:seriesLoading'
const READY = 'plugin:fetch-timeseries:seriesReady'
const ERROR = 'plugin:fetch-timeseries:seriesError'
const CLEARED = 'plugin:fetch-timeseries:seriesCleared'

const LAYER = 'uuid-1'

const okResponse = () => ({
    ok: true,
    json: async () => [{ datetime: '2026-01-01T00:00:00Z', value: 1 }],
})

function clickPayload(over = {}) {
    return {
        feature: {
            properties: { code: 'A1', name: 'Station 42' },
            geometry: {},
        },
        layerName: LAYER,
        latlng: { lat: 30.3, lng: -97.7 },
        pixel: { x: 10, y: 20 },
        ...over,
    }
}

describe('FetchTimeseriesTool', () => {
    let handlers
    let emitted
    let layerConfigs
    let fetchMock
    let hasHandler

    const emittedFor = (event) =>
        emitted.filter(([e]) => e === event).map(([, p]) => p)

    const click = (payload = clickPayload()) =>
        FetchTimeseriesTool._onFeatureClick(payload)

    beforeEach(() => {
        handlers = {}
        emitted = []
        hasHandler = () => true
        layerConfigs = {
            [LAYER]: {
                display_name: 'Air Stations',
                variables: {
                    timeseries: { url: 'https://api/x?s={properties.code}' },
                },
            },
        }
        window.mmgisAPI = {
            on: (event, h) => {
                ;(handlers[event] ||= []).push(h)
                return () => {}
            },
            emit: (event, payload) => emitted.push([event, payload]),
            hasHandler: (name) => hasHandler(name),
            request: async (name, uuid) =>
                name === 'layers:getConfig' ? (layerConfigs[uuid] ?? null) : null,
        }
        fetchMock = vi.fn(async () => okResponse())
        vi.stubGlobal('fetch', fetchMock)
        FetchTimeseriesTool.make()
    })

    afterEach(() => {
        FetchTimeseriesTool.destroy()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        delete window.mmgisAPI
    })

    test('a click on a layer without a timeseries block emits nothing', async () => {
        layerConfigs[LAYER] = { variables: {} }
        await click()
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('happy path: loading, then a flat valid seriesReady payload', async () => {
        await click()
        expect(emittedFor(LOADING)).toEqual([
            { chartId: 'vector-timeseries', title: 'Station 42' },
        ])
        const [ready] = emittedFor(READY)
        expect(isChartSeriesPayload(ready)).toBe(true)
        expect(ready.chartId).toBe('vector-timeseries')
        expect(ready).not.toHaveProperty('payload')
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api/x?s=A1',
            expect.anything(),
        )
    })

    test('{lon}/{lat} resolve from the click location when geometry is empty', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?lon={lon}&lat={lat}'
        await click()
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api/x?lon=-97.7&lat=30.3',
            expect.anything(),
        )
        expect(emittedFor(ERROR)).toEqual([])
    })

    test('a second click aborts the first fetch; only its chart arrives', async () => {
        let resolveSecond
        fetchMock
            .mockImplementationOnce(
                (url, opts) =>
                    new Promise((resolve, reject) => {
                        opts.signal.addEventListener('abort', () =>
                            reject(new DOMException('aborted', 'AbortError')),
                        )
                    }),
            )
            .mockImplementationOnce(
                () => new Promise((resolve) => (resolveSecond = resolve)),
            )
        const first = click()
        const second = click()
        // Both clicks await the layer-config lookup before fetching.
        await new Promise((r) => setTimeout(r, 0))
        resolveSecond(okResponse())
        await Promise.all([first, second])
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
        expect(emittedFor(LOADING)).toHaveLength(2)
        expect(emittedFor(READY)).toHaveLength(1)
        expect(emittedFor(ERROR)).toEqual([])
    })

    test('an HTTP error becomes a seriesError card', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
        await click()
        expect(emittedFor(ERROR)).toEqual([
            {
                chartId: 'vector-timeseries',
                message: 'Could not load data (HTTP 502)',
            },
        ])
    })

    test('a bad URL template becomes a seriesError card without fetching', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?s={properties.missing}'
        await click()
        expect(fetchMock).not.toHaveBeenCalled()
        const [error] = emittedFor(ERROR)
        expect(error.message).toContain('properties.missing')
    })

    test('a stalled fetch times out into a seriesError card', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.useFakeTimers()
        fetchMock.mockImplementationOnce(
            (url, opts) =>
                new Promise((resolve, reject) => {
                    opts.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    )
                }),
        )
        const pending = click()
        await vi.advanceTimersByTimeAsync(30001)
        await pending
        vi.useRealTimers()
        expect(emittedFor(ERROR)).toEqual([
            { chartId: 'vector-timeseries', message: 'Request timed out' },
        ])
        warn.mockRestore()
    })

    test('destroy mid-flight aborts silently and clears the card', async () => {
        fetchMock.mockImplementationOnce(
            (url, opts) =>
                new Promise((resolve, reject) => {
                    opts.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    )
                }),
        )
        const pending = click()
        // Let the click reach its fetch before tearing down.
        await new Promise((r) => setTimeout(r, 0))
        FetchTimeseriesTool.destroy()
        await pending
        expect(emittedFor(CLEARED)).toEqual([{ chartId: 'vector-timeseries' }])
        expect(emittedFor(ERROR)).toEqual([])
        expect(emittedFor(READY)).toEqual([])
    })

    test('clicks before layers:getConfig registers are silent no-ops', async () => {
        hasHandler = () => false
        handlers['feature:click'][0](clickPayload())
        await new Promise((r) => setTimeout(r, 0))
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('an unexpected handler throw is caught, not an unhandled rejection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        window.mmgisAPI.request = async () => {
            throw new Error('bus exploded')
        }
        handlers['feature:click'][0](clickPayload())
        await new Promise((r) => setTimeout(r, 0))
        expect(warn).toHaveBeenCalledWith(
            '[FetchTimeseries] click handling failed',
            expect.any(Error),
        )
        warn.mockRestore()
    })
})
