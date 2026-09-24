import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISSeriesChartAdapter } from '../../src/essence/Tools/SeriesChart/MMGISSeriesChartAdapter'
import { SeriesChartPanel } from '../../src/essence/Tools/SeriesChart/lib'

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
const CLEARED = 'plugin:fetch-timeseries:seriesCleared'

const validPayload = () => ({
    chartId: 'c1',
    title: 'Station 42',
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

    test('a flat seriesReady payload renders the chart card', () => {
        act(() => bus.emit(READY, validPayload()))
        expect(host.textContent).toContain('Station 42')
        expect(host.textContent).toContain('NO₂')
    })

    test('several series get a Variable dropdown; the pick drives the footer', () => {
        const payload = validPayload()
        payload.series.push({
            id: 'o3',
            label: 'O₃',
            unit: 'ppm',
            points: [{ x: '2026-01-01T00:00:00Z', y: 0.04 }],
        })
        act(() => bus.emit(READY, payload))
        const select = host.querySelector('select.series-chart__picker-select')
        expect([...select.options].map((o) => o.textContent)).toEqual(['NO₂', 'O₃'])
        const chip = () => host.querySelector('.series-chart__variable-chip').textContent
        expect(chip()).toContain('NO₂')

        act(() => {
            select.value = 'o3'
            select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        expect(chip()).toContain('O₃')
        expect(chip()).toContain('ppm')
    })

    test('the list layout picks with a row of buttons instead', () => {
        const payload = validPayload()
        payload.series.push({
            id: 'o3',
            label: 'O₃',
            unit: 'ppm',
            points: [{ x: '2026-01-01T00:00:00Z', y: 0.04 }],
        })
        const cards = [{ chartId: 'c1', payload }]
        act(() =>
            root.render(
                React.createElement(SeriesChartPanel, { cards, layout: 'list' }),
            ),
        )
        expect(host.querySelector('select')).toBeNull()
        const tabs = [...host.querySelectorAll('.series-chart__variable-tab')]
        expect(tabs.map((t) => t.textContent)).toEqual(['NO₂', 'O₃'])
        expect(tabs[0].getAttribute('aria-pressed')).toBe('true')

        act(() => tabs[1].click())
        expect(tabs[1].getAttribute('aria-pressed')).toBe('true')
        expect(
            host.querySelector('.series-chart__variable-chip').textContent,
        ).toContain('O₃')
    })

    test('the tool is shown when the first chart arrives and hidden when the last clears', async () => {
        bus.hasHandler = () => true
        bus.request = vi.fn(async () => ({ ok: true, state: 'visible', changed: true }))
        const commands = () =>
            bus.request.mock.calls
                .filter(([name]) => name === 'plugins:show' || name === 'plugins:hide')
                .map(([name, params]) => [name, params.pluginId])

        await act(async () => bus.emit(READY, validPayload()))
        expect(commands()).toEqual([['plugins:show', 'SeriesChartTool']])

        // A second card while shown asks nothing more.
        await act(async () => bus.emit(READY, { ...validPayload(), chartId: 'c2' }))
        expect(commands()).toHaveLength(1)

        await act(async () => bus.emit(CLEARED, { chartId: 'c1' }))
        expect(commands()).toHaveLength(1)
        await act(async () => bus.emit(CLEARED, { chartId: 'c2' }))
        expect(commands()).toEqual([
            ['plugins:show', 'SeriesChartTool'],
            ['plugins:hide', 'SeriesChartTool'],
        ])
    })

    test('a single series gets no dropdown', () => {
        act(() => bus.emit(READY, validPayload()))
        expect(host.querySelector('select')).toBeNull()
    })

    test('an enveloped seriesReady is dropped with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        act(() => bus.emit(READY, validPayload()))
        act(() => bus.emit(READY, { payload: validPayload() }))
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('malformed seriesReady'),
            expect.anything(),
        )
        // The good card stays; the bad payload changed nothing.
        expect(host.textContent).toContain('Station 42')
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
