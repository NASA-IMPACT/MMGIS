import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Chart is a receiver with no trigger of its own: a FetchStats result reaches
 * the user only if the wrapper catches the event, renders the payload, and
 * brings the panel on screen.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const CONTAINER_ID = 'chart-panel-container'
const ANALYSIS_DATA = { co2: { mean: 1 } }

type Request = { name: string; params?: unknown }

let listeners: Record<string, ((payload?: unknown) => void)[]>
let requests: Request[]
/** The wrapper's props from its last render of the chart component. */
let chartProps: any
let ChartTool: any

const load = async () => {
    vi.resetModules()
    listeners = {}
    requests = []
    chartProps = null

    ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
        request: async (name: string, params?: unknown) => {
            requests.push({ name, params })
            return { ok: true, state: 'visible', changed: true }
        },
        hasHandler: () => true,
        on: (event: string, handler: (payload?: unknown) => void) => {
            ;(listeners[event] ||= []).push(handler)
            return () => {}
        },
        emit: () => {},
    }

    vi.doMock('../ChartComponent', () => ({
        default: (props: any) => {
            chartProps = props
            return null
        },
    }))

    ChartTool = (await import('../ChartTool')).default
}

/** Fires one bus event the way core's emitter would. */
const fire = (event: string, payload?: unknown) => {
    act(() => {
        ;(listeners[event] ?? []).forEach((handler) => handler(payload))
    })
}

const open = async () => {
    await act(async () => {
        ChartTool.make(CONTAINER_ID)
    })
}

const requested = (name: string) => requests.filter((r) => r.name === name)

describe('ChartTool hand-offs', () => {
    let container: HTMLElement

    beforeEach(async () => {
        container = document.createElement('div')
        container.id = CONTAINER_ID
        document.body.appendChild(container)
        await load()
    })

    afterEach(() => {
        act(() => ChartTool.destroy())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    test('a result with no panel yet asks the loader for one', async () => {
        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })

        expect(requested('plugins:show')).toEqual([
            { name: 'plugins:show', params: { pluginId: 'chart' } },
        ])
    })

    test('the panel it opens renders the result it was handed', async () => {
        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })
        await open()

        expect(chartProps.analysisData).toEqual(ANALYSIS_DATA)
    })

    test('a result reaches an open panel in place', async () => {
        await open()

        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })

        expect(chartProps.analysisData).toEqual(ANALYSIS_DATA)
    })

    test('a result to a mounted panel still asks for it to be shown', async () => {
        await open()
        const before = requested('plugins:show').length

        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })

        expect(requested('plugins:show').length).toBe(before + 1)
    })

    test('a new analysis clears stale results without opening the panel', async () => {
        await open()
        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })
        const before = requested('plugins:show').length

        fire('plugin:aoi:analysisAOIReady', { feature: {} })

        expect(chartProps.analysisData).toBeNull()
        expect(requested('plugins:show').length).toBe(before)
    })

    test('closing unloads the plugin so the next result re-mounts a panel', async () => {
        fire('plugin:fetch-stats:analysisReady', { analysisData: ANALYSIS_DATA })
        await open()

        await act(async () => {
            chartProps.onClose()
        })

        expect(requested('plugins:setState')).toEqual([
            {
                name: 'plugins:setState',
                params: { pluginId: 'chart', state: 'unloaded' },
            },
        ])
    })
})
