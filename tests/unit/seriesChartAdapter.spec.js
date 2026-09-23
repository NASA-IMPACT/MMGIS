import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISSeriesChartAdapter } from '../../src/essence/Tools/SeriesChart/MMGISSeriesChartAdapter'

// The ready card mounts a real chart; neither echarts' canvas nor
// ResizeObserver exist under jsdom, and neither is what's under test.
vi.mock('echarts', () => ({
    init: () => ({
        setOption() {},
        on() {},
        dispose() {},
        resize() {},
        getOption() {
            return {}
        },
        dispatchAction() {},
    }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const READY = 'plugin:fetch-timeseries:seriesReady'
const LOADING = 'plugin:fetch-timeseries:seriesLoading'
const ERROR = 'plugin:fetch-timeseries:seriesError'
const CLEARED = 'plugin:fetch-timeseries:seriesCleared'

const validPayload = () => ({
    chartId: 'c1',
    title: 'Station 42',
    xType: 'time',
    series: [
        {
            id: 'no2',
            label: 'NO₂',
            points: [{ x: '2026-01-01T00:00:00Z', y: 1.5 }],
        },
    ],
})

function makeBus() {
    const handlers = {}
    return {
        on(event, h) {
            ;(handlers[event] ||= []).push(h)
            return () => {
                handlers[event] = handlers[event].filter((x) => x !== h)
            }
        },
        emit(event, payload) {
            ;(handlers[event] || []).forEach((h) => h(payload))
        },
        request: async () => null,
    }
}

describe('MMGISSeriesChartAdapter', () => {
    let host
    let root
    let bus

    beforeEach(() => {
        globalThis.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        bus = makeBus()
        window.mmgisAPI = bus
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        act(() => root.render(React.createElement(MMGISSeriesChartAdapter)))
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        delete window.mmgisAPI
        vi.restoreAllMocks()
    })

    test('idle panel shows the placeholder', () => {
        expect(host.textContent).toContain('Select something on the map')
    })

    test('seriesLoading renders a spinner card with the title', () => {
        act(() => bus.emit(LOADING, { chartId: 'c1', title: 'Station 42' }))
        expect(host.textContent).toContain('Station 42')
        expect(host.textContent).toContain('Fetching data…')
    })

    test('a flat seriesReady payload renders the chart card', () => {
        act(() => bus.emit(READY, validPayload()))
        expect(host.textContent).toContain('Station 42')
        expect(host.textContent).toContain('NO₂')
        expect(host.textContent).not.toContain('Fetching data…')
    })

    test('an enveloped seriesReady is dropped with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        act(() => bus.emit(LOADING, { chartId: 'c1', title: 'Station 42' }))
        act(() => bus.emit(READY, { payload: validPayload() }))
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('malformed seriesReady'),
            expect.anything(),
        )
        expect(host.textContent).toContain('Fetching data…')
    })

    test('seriesError renders the message', () => {
        act(() => bus.emit(ERROR, { chartId: 'c1', message: 'Upstream 500' }))
        expect(host.textContent).toContain('Upstream 500')
    })

    test('seriesCleared removes the card', () => {
        act(() => bus.emit(READY, validPayload()))
        act(() => bus.emit(CLEARED, { chartId: 'c1' }))
        expect(host.textContent).toContain('Select something on the map')
    })

    test('an explicitly empty sources config disables all subscriptions', async () => {
        act(() => root.unmount())
        bus = makeBus()
        bus.hasHandler = () => true
        bus.request = async (name) =>
            name === 'tool:getVars' ? { sources: [] } : null
        window.mmgisAPI = bus
        root = createRoot(host)
        await act(async () =>
            root.render(React.createElement(MMGISSeriesChartAdapter)),
        )
        act(() => bus.emit(READY, validPayload()))
        expect(host.textContent).toContain('Select something on the map')
    })
})
