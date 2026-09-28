import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import FetchTimeseriesTool from '../../src/essence/Tools/FetchTimeseries/FetchTimeseriesTool'
import { isChartSeriesPayload } from '../../src/essence/Tools/_shared/types/chartSeries'

const READY = 'plugin:fetch-timeseries:seriesReady'
const CLEARED = 'plugin:fetch-timeseries:seriesCleared'

const LAYER = 'uuid-1'

const okResponse = () => ({
    ok: true,
    json: async () => [{ datetime: '2026-01-01T00:00:00Z', value: 1 }],
})

const FETCH = 'plugin:fetch-timeseries:fetch'

function fetchPayload(over = {}) {
    return {
        feature: {
            properties: { code: 'A1', name: 'Station 42' },
            geometry: {},
        },
        layerId: LAYER,
        latlng: { lat: 30.3, lng: -97.7 },
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
    const emittedNames = () => emitted.map(([e]) => e)

    const request = (payload = fetchPayload()) =>
        FetchTimeseriesTool._onFetch(payload)

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

    test('a request for a layer without a timeseries block emits nothing', async () => {
        layerConfigs[LAYER] = { variables: {} }
        await request()
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('a request without a layerId or a feature is ignored', async () => {
        await request(fetchPayload({ layerId: undefined }))
        await request(fetchPayload({ feature: null }))
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('the fetch event on the bus drives the same path as a direct call', async () => {
        handlers[FETCH][0](fetchPayload())
        await new Promise((r) => setTimeout(r, 0))
        expect(emittedNames()).toEqual([READY])
    })

    test('happy path: one flat valid seriesReady payload, nothing else', async () => {
        await request()
        expect(emittedNames()).toEqual([READY])
        const [ready] = emittedFor(READY)
        expect(isChartSeriesPayload(ready)).toBe(true)
        expect(ready.chartId).toBe('vector-timeseries')
        expect(ready).not.toHaveProperty('payload')
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api/x?s=A1',
            expect.anything(),
        )
    })

    test('{lon}/{lat} resolve from the request location when geometry is empty', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?lon={lon}&lat={lat}'
        await request()
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api/x?lon=-97.7&lat=30.3',
            expect.anything(),
        )
        expect(emittedNames()).toEqual([READY])
    })

    test('a second request aborts the first fetch; only its chart arrives', async () => {
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
        const first = request()
        const second = request()
        // Both requests await the layer-config lookup before fetching.
        await new Promise((r) => setTimeout(r, 0))
        resolveSecond(okResponse())
        await Promise.all([first, second])
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
        expect(emittedNames()).toEqual([READY])
    })

    test('an HTTP error is logged and emits nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
        await request()
        expect(emitted).toEqual([])
        expect(warn).toHaveBeenCalledWith(
            '[FetchTimeseries] Could not load data (HTTP 502)',
        )
    })

    test('a bad URL template is logged without fetching', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?s={properties.missing}'
        await request()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('properties.missing'),
        )
    })

    test('a stalled fetch times out, logged, emitting nothing', async () => {
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
        const pending = request()
        await vi.advanceTimersByTimeAsync(30001)
        await pending
        vi.useRealTimers()
        expect(emitted).toEqual([])
        expect(warn).toHaveBeenCalledWith('[FetchTimeseries] Request timed out')
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
        const pending = request()
        // Let the request reach its fetch before tearing down.
        await new Promise((r) => setTimeout(r, 0))
        FetchTimeseriesTool.destroy()
        await pending
        expect(emittedFor(CLEARED)).toEqual([{ chartId: 'vector-timeseries' }])
        expect(emittedNames()).toEqual([CLEARED])
    })

    test('requests before layers:getConfig registers are silent no-ops', async () => {
        hasHandler = () => false
        handlers[FETCH][0](fetchPayload())
        await new Promise((r) => setTimeout(r, 0))
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('an unexpected handler throw is caught, not an unhandled rejection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        window.mmgisAPI.request = async () => {
            throw new Error('bus exploded')
        }
        handlers[FETCH][0](fetchPayload())
        await new Promise((r) => setTimeout(r, 0))
        expect(warn).toHaveBeenCalledWith(
            '[FetchTimeseries] fetch request failed',
            expect.any(Error),
        )
        warn.mockRestore()
    })
})
