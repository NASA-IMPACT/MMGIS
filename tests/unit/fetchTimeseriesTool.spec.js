import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import FetchTimeseriesTool from '../../src/essence/Tools/FetchTimeseries/FetchTimeseriesTool'
import { isChartSeriesPayload } from '../../src/essence/Tools/_shared/types/chartSeries'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const READY = 'plugin:fetch-timeseries:seriesReady'
const CLEARED = 'plugin:fetch-timeseries:seriesCleared'
const FETCH = 'plugin:fetch-timeseries:fetch'

const LAYER = 'uuid-1'
const HOST = 'fetch-timeseries-host'

const okResponse = () => ({
    ok: true,
    json: async () => [{ datetime: '2026-01-01T00:00:00Z', value: 1 }],
})

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

/** The clause the fetcher appended, decoded, or null when the URL has none. */
const filterOf = (url) => {
    const m = new URL(url).searchParams.get('filter')
    return m
}

describe('FetchTimeseriesTool', () => {
    let handlers
    let emitted
    let requests
    let layerConfigs
    let fetchMock
    let hasHandler
    let timeEnabled
    let host

    const emittedFor = (event) =>
        emitted.filter(([e]) => e === event).map(([, p]) => p)
    const requested = (name) => requests.filter(([n]) => n === name)

    const request = (payload = fetchPayload()) =>
        act(() => FetchTimeseriesTool._onFetch(payload))

    const input = (label) =>
        [...host.querySelectorAll('label')]
            .find((l) => l.textContent.includes(label))
            .querySelector('input')

    const setDate = (label, value) =>
        act(() => {
            const el = input(label)
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            ).set
            setter.call(el, value)
            el.dispatchEvent(new Event('input', { bubbles: true }))
        })

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
        vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
        handlers = {}
        emitted = []
        requests = []
        hasHandler = () => true
        timeEnabled = false
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
            request: async (name, params) => {
                requests.push([name, params])
                if (name === 'layers:getConfig') return layerConfigs[params] ?? null
                if (name === 'time:isEnabled') return timeEnabled
                if (name === 'time:getStart') return '2018-01-01T00:00:00Z'
                if (name === 'time:getEnd') return '2019-12-31T00:00:00Z'
                if (name === 'plugins:show') return { ok: true, state: 'visible', changed: true }
                return null
            },
        }
        fetchMock = vi.fn(async () => okResponse())
        vi.stubGlobal('fetch', fetchMock)
        host = document.createElement('div')
        host.id = HOST
        document.body.appendChild(host)
        act(() => FetchTimeseriesTool.make(HOST))
    })

    afterEach(() => {
        act(() => FetchTimeseriesTool.destroy())
        host.remove()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        vi.useRealTimers()
        delete window.mmgisAPI
    })

    test('a request for a layer without a timeseries block does nothing', async () => {
        layerConfigs[LAYER] = { variables: {} }
        await request()
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
        expect(requested('plugins:show')).toEqual([])
    })

    test('a request without a layerId or a feature is ignored', async () => {
        await request(fetchPayload({ layerId: undefined }))
        await request(fetchPayload({ feature: null }))
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('the fetch event on the bus drives the same path as a direct call', async () => {
        await act(async () => {
            handlers[FETCH][0](fetchPayload())
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(emittedFor(READY)).toHaveLength(1)
    })

    test('happy path: the card shows, the URL carries the past-year range, only seriesReady is emitted', async () => {
        await request()
        expect(requested('plugins:show')).toEqual([
            ['plugins:show', { pluginId: 'FetchTimeseriesTool' }],
        ])
        expect(host.textContent).toContain('Station 42')
        expect(host.textContent).toContain('Air Stations')
        expect(input('Start date').value).toBe('2025-09-24')
        expect(input('End date').value).toBe('2026-09-24')

        const [url] = fetchMock.mock.calls[0]
        expect(url.startsWith('https://api/x?s=A1&filter=')).toBe(true)
        expect(filterOf(url)).toBe(
            "datetime >= '2025-09-24T00:00:00' AND datetime <= '2026-09-24T23:59:59'",
        )
        expect(new URL(url).searchParams.get('filter-lang')).toBe('cql2-text')

        expect(emitted.map(([e]) => e)).toEqual([READY])
        const [ready] = emittedFor(READY)
        expect(isChartSeriesPayload(ready)).toBe(true)
        expect(ready.chartId).toBe('vector-timeseries')
        expect(host.textContent).not.toContain('Fetching data…')
    })

    test('the range seeds from the mission time window when time is enabled', async () => {
        timeEnabled = true
        await request()
        expect(input('Start date').value).toBe('2018-01-01')
        expect(input('End date').value).toBe('2019-12-31')
        expect(filterOf(fetchMock.mock.calls[0][0])).toContain("datetime >= '2018-01-01T00:00:00'")
    })

    test('the filter uses the configured time property, without a properties prefix', async () => {
        layerConfigs[LAYER].variables.timeseries.xKey = 'properties.obs_time'
        await request()
        expect(filterOf(fetchMock.mock.calls[0][0])).toContain("obs_time >= '")
    })

    test('changing a date refetches the same feature over the new range and emits again', async () => {
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await setDate('Start date', '2026-03-01')
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(filterOf(fetchMock.mock.calls[1][0])).toBe(
            "datetime >= '2026-03-01T00:00:00' AND datetime <= '2026-09-24T23:59:59'",
        )
        expect(emittedFor(READY)).toHaveLength(2)
    })

    test('a start after the end drags the end along, and the reverse', async () => {
        await request()
        await setDate('Start date', '2026-12-01')
        expect(input('End date').value).toBe('2026-12-01')
        await setDate('End date', '2026-02-01')
        expect(input('Start date').value).toBe('2026-02-01')
    })

    test('a date change before any feature is picked fetches nothing', async () => {
        await act(async () => {
            FetchTimeseriesTool._onRangeChange('2026-01-01', '2026-02-01')
        })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })

    test('{lon}/{lat} resolve from the request location when geometry is empty', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?lon={lon}&lat={lat}'
        await request()
        expect(fetchMock.mock.calls[0][0].startsWith('https://api/x?lon=-97.7&lat=30.3&filter=')).toBe(true)
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
        await act(async () => {
            const first = FetchTimeseriesTool._onFetch(fetchPayload())
            const second = FetchTimeseriesTool._onFetch(fetchPayload())
            // Both requests await the layer-config lookup before fetching.
            await vi.advanceTimersByTimeAsync(0)
            resolveSecond(okResponse())
            await Promise.all([first, second])
        })
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
        expect(emittedFor(READY)).toHaveLength(1)
    })

    test('an HTTP error shows on the card and emits nothing', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
        await request()
        expect(host.textContent).toContain('Could not load data (HTTP 502)')
        expect(emitted).toEqual([])
    })

    test('a bad URL template shows on the card without fetching', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?s={properties.missing}'
        await request()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(host.textContent).toContain('properties.missing')
        expect(emitted).toEqual([])
    })

    test('a stalled fetch times out onto the card', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        fetchMock.mockImplementationOnce(
            (url, opts) =>
                new Promise((resolve, reject) => {
                    opts.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    )
                }),
        )
        await act(async () => {
            const pending = FetchTimeseriesTool._onFetch(fetchPayload())
            await vi.advanceTimersByTimeAsync(30001)
            await pending
        })
        expect(host.textContent).toContain('Request timed out')
        expect(emitted).toEqual([])
        warn.mockRestore()
    })

    test('destroy mid-flight aborts silently and clears the chart', async () => {
        fetchMock.mockImplementationOnce(
            (url, opts) =>
                new Promise((resolve, reject) => {
                    opts.signal.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    )
                }),
        )
        await act(async () => {
            const pending = FetchTimeseriesTool._onFetch(fetchPayload())
            // Let the request reach its fetch before tearing down.
            await vi.advanceTimersByTimeAsync(0)
            FetchTimeseriesTool.destroy()
            await pending
        })
        expect(emittedFor(CLEARED)).toEqual([{ chartId: 'vector-timeseries' }])
        expect(emittedFor(READY)).toEqual([])
    })

    test('requests before layers:getConfig registers are silent no-ops', async () => {
        hasHandler = () => false
        await request()
        expect(emitted).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('an unexpected handler throw is caught, not an unhandled rejection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        window.mmgisAPI.request = async () => {
            throw new Error('bus exploded')
        }
        await act(async () => {
            handlers[FETCH][0](fetchPayload())
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(warn).toHaveBeenCalledWith(
            '[FetchTimeseries] fetch request failed',
            expect.any(Error),
        )
        warn.mockRestore()
    })
})
