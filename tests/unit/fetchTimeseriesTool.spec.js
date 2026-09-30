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

/** The layer's URL: the range goes wherever its author put {start}/{end}. */
const RANGED_URL =
    "https://api/x?s={properties.code}&filter=datetime >= '{start}' AND datetime <= '{end}'&filter-lang=cql2-text"

/** The filter clause as the server would read it, or null when the URL has none. */
const filterOf = (url) => new URL(url).searchParams.get('filter')

describe('FetchTimeseriesTool', () => {
    let handlers
    let emitted
    let requests
    let layerConfigs
    let fetchMock
    let hasHandler
    let timeEnabled
    let host
    let configGate
    let extents

    const emittedFor = (event) =>
        emitted.filter(([e]) => e === event).map(([, p]) => p)
    const requested = (name) => requests.filter(([n]) => n === name)

    const request = (payload = fetchPayload()) =>
        act(() => FetchTimeseriesTool._onFetch(payload))

    const input = (label) =>
        [...host.querySelectorAll('label')]
            .find((l) => l.textContent.includes(label))
            .querySelector('input')
    // datetime-local serializes zero seconds away (and jsdom, unlike browsers,
    // appends zero milliseconds); read it back to the second either way.
    const valueOf = (label) => {
        const v = input(label).value.replace(/\.000$/, '')
        return v.length === 16 ? `${v}:00` : v
    }

    const blur = (label) =>
        act(() => {
            input(label).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
        })

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
        configGate = null
        extents = {}
        layerConfigs = {
            [LAYER]: {
                display_name: 'Air Stations',
                variables: {
                    timeseries: { url: RANGED_URL },
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
                if (name === 'layers:getConfig') {
                    if (configGate) await configGate
                    return layerConfigs[params] ?? null
                }
                if (name === 'layers:getTemporalExtent') return extents[params] ?? null
                if (name === 'time:isEnabled') return timeEnabled
                if (name === 'time:getStart') return '2018-01-01T00:00:00Z'
                if (name === 'time:getEnd') return '2019-12-31T00:00:00Z'
                if (name === 'plugins:show') return { ok: true, state: 'visible', changed: true }
                if (name === 'plugins:hide') return { ok: true, state: 'hidden', changed: true }
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
        expect(valueOf('Start')).toBe('2025-09-24T00:00:00')
        expect(valueOf('End')).toBe('2026-09-24T23:59:59')

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

    test('without a layer extent, the range seeds from the mission time window, clipped to its last year', async () => {
        timeEnabled = true
        await request()
        expect(valueOf('Start')).toBe('2018-12-31T00:00:00')
        expect(valueOf('End')).toBe('2019-12-31T00:00:00')
        expect(filterOf(fetchMock.mock.calls[0][0])).toContain("datetime >= '2018-12-31T00:00:00'")
    })

    test("the range seeds from the layer's own extent", async () => {
        timeEnabled = true
        extents[LAYER] = { start: '2023-06-01T00:00:00Z', end: '2023-06-30T23:59:59Z', interval: null }
        await request()
        expect(valueOf('Start')).toBe('2023-06-01T00:00:00')
        expect(valueOf('End')).toBe('2023-06-30T23:59:59')
        expect(filterOf(fetchMock.mock.calls[0][0])).toBe(
            "datetime >= '2023-06-01T00:00:00' AND datetime <= '2023-06-30T23:59:59'",
        )
    })

    test('an extent longer than a year seeds its last year, with a future end capped at today', async () => {
        extents[LAYER] = { start: '2020-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z', interval: null }
        await request()
        expect(valueOf('Start')).toBe('2025-09-24T00:00:00')
        expect(valueOf('End')).toBe('2026-09-24T23:59:59')
    })

    test("the layer's Default Range sets how far back the card opens", async () => {
        extents[LAYER] = { start: '2023-06-01T00:00:00Z', end: '2023-06-30T23:59:59Z', interval: null }
        layerConfigs[LAYER].variables.timeseries.defaultSpan = '1 day'
        await request()
        expect(valueOf('Start')).toBe('2023-06-29T00:00:00')
        expect(valueOf('End')).toBe('2023-06-30T23:59:59')
    })

    test('an hour-long Default Range keeps the clock', async () => {
        extents[LAYER] = { start: '2023-06-01T00:00:00Z', end: '2023-06-30T23:59:59Z', interval: null }
        layerConfigs[LAYER].variables.timeseries.defaultSpan = '1 hour'
        await request()
        expect(valueOf('Start')).toBe('2023-06-30T22:59:59')
    })

    test('an unreadable Default Range warns and seeds a year', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        extents[LAYER] = { start: '2020-01-01T00:00:00Z', end: '2023-06-30T23:59:59Z', interval: null }
        layerConfigs[LAYER].variables.timeseries.defaultSpan = 'a while'
        await request()
        expect(valueOf('Start')).toBe('2022-06-30T00:00:00')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreadable defaultSpan'))
        warn.mockRestore()
    })

    test('an extent with an open start seeds the year before its end', async () => {
        extents[LAYER] = { start: null, end: '2023-06-30T23:59:59Z', interval: null }
        await request()
        expect(valueOf('Start')).toBe('2022-06-30T00:00:00')
        expect(valueOf('End')).toBe('2023-06-30T23:59:59')
    })

    test("a second pick on the same layer keeps the viewer's dates; another layer reseeds", async () => {
        const LAYER2 = 'uuid-2'
        extents[LAYER] = { start: '2023-06-01T00:00:00Z', end: '2023-06-30T23:59:59Z', interval: null }
        extents[LAYER2] = { start: '2024-01-01T00:00:00Z', end: '2024-01-31T23:59:59Z', interval: null }
        layerConfigs[LAYER2] = { display_name: 'Other', variables: { timeseries: { url: RANGED_URL } } }
        await request()
        await setDate('Start', '2023-06-10T00:00:00')
        await settle()
        await request()
        expect(valueOf('Start')).toBe('2023-06-10T00:00:00')
        await request(fetchPayload({ layerId: LAYER2 }))
        expect(valueOf('Start')).toBe('2024-01-01T00:00:00')
        expect(valueOf('End')).toBe('2024-01-31T23:59:59')
    })

    test('{start}/{end} expand wherever the author put them, URL-encoded', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?s={properties.code}&datetime={start}Z/{end}Z'
        await request()
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://api/x?s=A1&datetime=2025-09-24T00%3A00%3A00Z/2026-09-24T23%3A59%3A59Z',
        )
    })

    test('a URL without range placeholders still shows the pickers, and a range change refetches it unchanged', async () => {
        layerConfigs[LAYER].variables.timeseries.url = 'https://api/x?s={properties.code}'
        await request()
        expect(fetchMock.mock.calls[0][0]).toBe('https://api/x?s=A1')
        expect(host.querySelectorAll('input')).toHaveLength(2)
        await setDate('Start', '2026-01-01T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1][0]).toBe('https://api/x?s=A1')
    })

    /** An OGC Features page: points under `features`, the standard counters,
     *  and a `next` link when there is more. */
    const page = (values, { matched, returned = values.length, next = null } = {}) => ({
        ok: true,
        json: async () => ({
            type: 'FeatureCollection',
            numberMatched: matched ?? values.length,
            numberReturned: returned,
            links: next ? [{ rel: 'next', href: next }] : [],
            features: values.map((value, i) => ({
                properties: { datetime: `2026-01-0${i + 1}T00:00:00Z`, value },
            })),
        }),
    })
    const pointsOut = () => emittedFor(READY)[0].series[0].points.map((p) => p.y)
    /** A request awaits several bus answers before its first fetch, and each
     *  page after it; this drains the microtask chain without a timer. */
    const flush = () =>
        act(async () => {
            for (let i = 0; i < 40; i++) await Promise.resolve()
        })

    test('follows next links and charts every page as one series', async () => {
        fetchMock
            .mockResolvedValueOnce(page([1, 2], { matched: 3, next: 'https://api/x?offset=2' }))
            .mockResolvedValueOnce(page([3], { matched: 3 }))
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1][0]).toBe('https://api/x?offset=2')
        expect(emittedFor(READY)).toHaveLength(1)
        expect(pointsOut()).toEqual([1, 2, 3])
        // Every page arrived, so the title carries no truncation notice.
        expect(emittedFor(READY)[0].title).not.toContain('first ')
        expect(host.textContent).not.toContain('Fetching data…')
    })

    test('stops when the rows gathered reach numberMatched, even with a next link offered', async () => {
        fetchMock.mockResolvedValueOnce(page([1, 2], { matched: 2, next: 'https://api/x?offset=2' }))
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(pointsOut()).toEqual([1, 2])
    })

    test('the card counts pages while it walks', async () => {
        let resolveSecond
        fetchMock
            .mockResolvedValueOnce(page([1, 2], { matched: 6, next: 'https://api/x?offset=2' }))
            .mockImplementationOnce(
                (url, opts) =>
                    new Promise((resolve, reject) => {
                        resolveSecond = resolve
                        opts.signal.addEventListener('abort', () =>
                            reject(new DOMException('aborted', 'AbortError')),
                        )
                    }),
            )
            .mockResolvedValueOnce(page([5, 6], { matched: 6 }))
        const pending = FetchTimeseriesTool._onFetch(fetchPayload())
        await flush()
        expect(host.textContent).toContain('Fetching data… page 2 of 3')
        // The third page answers at once, so the walk completes here.
        resolveSecond(page([3, 4], { matched: 6, next: 'https://api/x?offset=4' }))
        await act(async () => {
            await pending
        })
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(host.textContent).not.toContain('Fetching data…')
        expect(pointsOut()).toEqual([1, 2, 3, 4, 5, 6])
    })

    test('EXIT between pages emits nothing more', async () => {
        fetchMock
            .mockResolvedValueOnce(page([1], { matched: 2, next: 'https://api/x?offset=1' }))
            .mockImplementationOnce(
                (url, opts) =>
                    new Promise((resolve, reject) => {
                        opts.signal.addEventListener('abort', () =>
                            reject(new DOMException('aborted', 'AbortError')),
                        )
                    }),
            )
        const pending = FetchTimeseriesTool._onFetch(fetchPayload())
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await act(async () => {
            host.querySelector('.range-card__exit').click()
        })
        await act(async () => {
            await pending
        })
        expect(emitted.map(([e]) => e)).toEqual([CLEARED])
    })

    test('more pages than the cap fails on the card instead of charting a truncated series', async () => {
        fetchMock.mockImplementation(async (url) =>
            page([1], { matched: 1e9, next: `${url}&more` }),
        )
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(100)
        expect(host.textContent).toContain('More than 100 pages of data')
        expect(emitted.map(([e]) => e)).toEqual([CLEARED])
    })

    /** The refetch waits for typing to settle; this lets it fire. */
    const settle = () =>
        act(async () => {
            await vi.advanceTimersByTimeAsync(400)
        })

    test('changing a date refetches the same feature over the new range and emits again', async () => {
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await setDate('Start', '2026-03-01T00:00:00')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(filterOf(fetchMock.mock.calls[1][0])).toBe(
            "datetime >= '2026-03-01T00:00:00' AND datetime <= '2026-09-24T23:59:59'",
        )
        expect(emittedFor(READY)).toHaveLength(2)
    })

    test('quick successive changes refetch once, with the last range', async () => {
        await request()
        await setDate('Start', '2026-03-01T00:00:00')
        await setDate('Start', '2026-04-01T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(filterOf(fetchMock.mock.calls[1][0])).toContain("datetime >= '2026-04-01T00:00:00'")
    })

    test('a partial year typed into End leaves Start alone and fetches only the finished value', async () => {
        await request()
        // Chrome's change events while typing a year: 0002-…, then the real one.
        await setDate('End', '0002-03-01T00:00:00')
        expect(valueOf('Start')).toBe('2025-09-24T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await setDate('End', '2027-03-01T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(filterOf(fetchMock.mock.calls[1][0])).toBe(
            "datetime >= '2025-09-24T00:00:00' AND datetime <= '2027-03-01T00:00:00'",
        )
    })

    test('destroy during the refetch wait cancels it', async () => {
        await request()
        await setDate('Start', '2026-03-01T00:00:00')
        act(() => FetchTimeseriesTool.destroy())
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('destroy while the layer lookup is pending fetches nothing afterwards', async () => {
        let release
        configGate = new Promise((resolve) => (release = resolve))
        const pending = FetchTimeseriesTool._onFetch(fetchPayload())
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
            FetchTimeseriesTool.destroy()
            release()
            await pending
        })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(requested('plugins:show')).toEqual([])
        expect(emitted.map(([e]) => e)).toEqual([CLEARED])
        expect(host.innerHTML).toBe('')
    })

    test('EXIT while the layer lookup is pending does not reopen the card', async () => {
        await request()
        let release
        configGate = new Promise((resolve) => (release = resolve))
        const pending = FetchTimeseriesTool._onFetch(fetchPayload())
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
            host.querySelector('.range-card__exit').click()
            release()
            await pending
        })
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(requested('plugins:show')).toHaveLength(1)
        expect(requested('plugins:hide')).toHaveLength(1)
        expect(emittedFor(READY)).toHaveLength(1)
        expect(FetchTimeseriesTool._selection).toBeNull()
    })

    test('EXIT during the refetch wait cancels it', async () => {
        await request()
        await setDate('Start', '2026-03-01T00:00:00')
        await act(async () => {
            host.querySelector('.range-card__exit').click()
        })
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('an end typed before the start leaves the start alone and fetches nothing until the field is left', async () => {
        await request()
        await setDate('Start', '2026-03-15T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        // Typing "25" into the day of End passes through 02 on the way.
        await setDate('End', '2026-03-02T00:00:00')
        expect(valueOf('Start')).toBe('2026-03-15T00:00:00')
        expect(valueOf('End')).toBe('2026-03-02T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await setDate('End', '2026-03-25T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(filterOf(fetchMock.mock.calls[2][0])).toBe(
            "datetime >= '2026-03-15T00:00:00' AND datetime <= '2026-03-25T00:00:00'",
        )
    })

    test('leaving a field with the range reversed snaps the other bound to it; the refetch uses the clamped range', async () => {
        await request()
        await setDate('End', '2025-02-01T00:00:00')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await blur('End')
        expect(valueOf('Start')).toBe('2025-02-01T00:00:00')
        await settle()
        expect(filterOf(fetchMock.mock.calls[1][0])).toBe(
            "datetime >= '2025-02-01T00:00:00' AND datetime <= '2025-02-01T00:00:00'",
        )
        await setDate('Start', '2025-12-01T00:00:00')
        await blur('Start')
        expect(valueOf('End')).toBe('2025-12-01T00:00:00')
        await settle()
        expect(filterOf(fetchMock.mock.calls[2][0])).toBe(
            "datetime >= '2025-12-01T00:00:00' AND datetime <= '2025-12-01T00:00:00'",
        )
        expect(emittedFor(READY)).toHaveLength(3)
    })

    test('leaving a field with the range in order changes nothing', async () => {
        await request()
        await blur('End')
        await blur('Start')
        await settle()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(valueOf('Start')).toBe('2025-09-24T00:00:00')
    })

    test('EXIT clears the chart, hides this card, and leaves the next request working', async () => {
        await request()
        expect(emittedFor(READY)).toHaveLength(1)
        await act(async () => {
            host.querySelector('.range-card__exit').click()
        })
        expect(emittedFor(CLEARED)).toEqual([{ chartId: 'vector-timeseries' }])
        expect(requested('plugins:hide')).toEqual([
            ['plugins:hide', { pluginId: 'FetchTimeseriesTool' }],
        ])
        // A range change now fetches nothing: the selection is gone.
        await setDate('Start', '2026-03-01T00:00:00')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // The next request reopens and fetches again.
        await request()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(requested('plugins:show')).toHaveLength(2)
    })

    test('a range change before any feature is picked fetches nothing', async () => {
        await act(async () => {
            FetchTimeseriesTool._onRangeChange('2026-01-01T00:00:00', '2026-02-01T00:00:00')
        })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })

    test('{lon}/{lat} resolve from the request location when geometry is empty', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?lon={lon}&lat={lat}&start={start}'
        await request()
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://api/x?lon=-97.7&lat=30.3&start=2025-09-24T00%3A00%3A00',
        )
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
            // The first request reaches its fetch before the second arrives.
            await vi.advanceTimersByTimeAsync(0)
            const second = FetchTimeseriesTool._onFetch(fetchPayload())
            await vi.advanceTimersByTimeAsync(0)
            resolveSecond(okResponse())
            await Promise.all([first, second])
        })
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
        expect(emittedFor(READY)).toHaveLength(1)
    })

    test('an HTTP error shows on the card and clears the chart', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
        await request()
        expect(host.textContent).toContain('Could not load data (HTTP 502)')
        expect(emitted).toEqual([[CLEARED, { chartId: 'vector-timeseries' }]])
    })

    test('a failed refetch takes the previous chart down with it', async () => {
        await request()
        expect(emitted.map(([e]) => e)).toEqual([READY])
        fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
        await setDate('Start', '2026-03-01T00:00:00')
        await settle()
        expect(emitted.map(([e]) => e)).toEqual([READY, CLEARED])
        expect(host.textContent).toContain('HTTP 502')
    })

    test('a narrowed range with no data clears the chart and says so', async () => {
        await request()
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] })
        await setDate('Start', '2026-03-01T00:00:00')
        await settle()
        expect(emitted.map(([e]) => e)).toEqual([READY, CLEARED])
        expect(host.textContent).toContain('No data points in the response')
    })

    test('a bad URL template shows on the card without fetching', async () => {
        layerConfigs[LAYER].variables.timeseries.url =
            'https://api/x?s={properties.missing}'
        await request()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(host.textContent).toContain('properties.missing')
        expect(emitted.map(([e]) => e)).toEqual([CLEARED])
    })

    test('a later request whose layer lookup finishes first wins the selection', async () => {
        const lookups = []
        const base = window.mmgisAPI.request
        window.mmgisAPI.request = (name, params) =>
            name === 'layers:getConfig'
                ? new Promise((resolve) => lookups.push(() => resolve(layerConfigs[params])))
                : base(name, params)
        const featureWith = (code) =>
            fetchPayload({ feature: { properties: { code, name: code }, geometry: {} } })
        await act(async () => {
            const first = FetchTimeseriesTool._onFetch(featureWith('A1'))
            const second = FetchTimeseriesTool._onFetch(featureWith('B2'))
            await vi.advanceTimersByTimeAsync(0)
            lookups[1]()
            lookups[0]()
            await Promise.all([first, second])
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0].startsWith('https://api/x?s=B2&')).toBe(true)
        expect(FetchTimeseriesTool._selection.feature.properties.code).toBe('B2')
    })

    test('a refused show is warned about, not swallowed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const base = window.mmgisAPI.request
        window.mmgisAPI.request = (name, params) =>
            name === 'plugins:show'
                ? Promise.resolve({ ok: false, reason: 'not-in-layout' })
                : base(name, params)
        await request()
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(warn).toHaveBeenCalledWith('[FetchTimeseries] show refused: not-in-layout')
        warn.mockRestore()
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
        expect(emitted.map(([e]) => e)).toEqual([CLEARED])
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
