import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MMGISLayerManagerAdapter } from '../MMGISLayerManagerAdapter'
import { mount, type Mounted } from '../../_shared/__tests__/reactHarness'

/**
 * The adapter against a fake bus: request handlers plus a real subscriber
 * list. Layer UUIDs differ from display names, since coverage is UUID-keyed.
 */

const SPARSE = 'Sparse_0123456789abcdef'
const CONTINUOUS = 'Continuous_fedcba9876543210'
const EVENT = 'layers:dataCoverageChanged'

let outOfRange: Record<string, boolean>
let listed: Record<string, boolean>
let configs: Record<string, Record<string, unknown>>
let configWrites: unknown[]
let visible: Record<string, boolean>
let runsAnswer: Record<string, { runs: string[]; selected: string | null; step: string; lead: number | null }>
let runRequests: unknown[]
let configReads: number
let listeners: Map<string, Set<(payload?: unknown) => void>>
let gate: Promise<void> | null
let mounted: Mounted | null

beforeEach(() => {
    outOfRange = {}
    listed = {}
    configs = {
        [SPARSE]: { display_name: 'Sparse' },
        [CONTINUOUS]: { display_name: 'Continuous' },
    }
    configWrites = []
    visible = { [SPARSE]: true, [CONTINUOUS]: true }
    runsAnswer = {}
    runRequests = []
    configReads = 0
    listeners = new Map()
    gate = null
    mounted = null
    const handlers: Record<string, () => unknown> = {
        'layers:getAll': () => ({}),
        'tool:getVars': () => ({}),
        'layers:getAllConfigs': () => {
            configReads++
            return configs
        },
        'layers:updateConfig': () => true,
        'layers:refresh': () => true,
        'layers:getRuns': () => runsAnswer,
        'layers:setRun': () => true,
        // Read after coverage, so a held gate stands for a refresh that has
        // already read coverage but not yet landed.
        'layers:getVisible': async () => {
            if (gate) await gate
            return visible
        },
        'layers:getAllOpacities': () => ({}),
        'layers:getListed': () => listed,
        'layers:getDataCoverage': () =>
            Object.fromEntries(
                Object.entries(outOfRange).map(([id, flag]) => [
                    id,
                    { outOfDataRange: flag },
                ]),
            ),
    }
    ;(window as any).mmgisAPI = {
        request: async (name: string, params?: unknown) => {
            if (!handlers[name]) throw new Error(`No handler for ${name}`)
            if (name === 'layers:updateConfig') configWrites.push(params)
            if (name === 'layers:setRun') runRequests.push(params)
            return handlers[name]()
        },
        hasHandler: (name: string) => name in handlers,
        on: (event: string, handler: (payload?: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)!.add(handler)
            return () => listeners.get(event)?.delete(handler)
        },
        emit: (event: string, payload?: unknown) => {
            for (const handler of [...(listeners.get(event) ?? [])]) handler(payload)
        },
    }
})

afterEach(async () => {
    await mounted?.unmount()
    delete (window as any).mmgisAPI
})

const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })

const emit = (event: string, payload?: unknown) =>
    act(async () => {
        ;(window as any).mmgisAPI.emit(event, payload)
    })

const announce = (layerName: string, flag: boolean) => {
    outOfRange[layerName] = flag
    return emit(EVENT, { layerName, outOfDataRange: flag })
}

const flagged = () =>
    Array.from(
        mounted!.container.querySelectorAll('.blocks-layer-legend__coverage-warning'),
    ).map((el) => el.closest('[data-legend-id]')!.getAttribute('data-legend-id'))

const mountAdapter = async () => {
    mounted = await mount(<MMGISLayerManagerAdapter />)
    await settle()
}

describe('MMGISLayerManagerAdapter data coverage', () => {
    test('flags layers on first render and follows announced changes', async () => {
        outOfRange = { [SPARSE]: true, [CONTINUOUS]: false }
        await mountAdapter()
        expect(flagged()).toEqual([SPARSE])

        await announce(CONTINUOUS, true)
        await announce(SPARSE, false)
        expect(flagged()).toEqual([CONTINUOUS])
    })

    test('keeps a change announced while a refresh was reading', async () => {
        outOfRange = { [SPARSE]: false }
        await mountAdapter()

        let release!: () => void
        gate = new Promise((resolve) => (release = resolve))
        await emit('layers:listChanged')
        await announce(SPARSE, true)

        gate = null
        release()
        await settle()
        expect(flagged()).toEqual([SPARSE])
    })

    test('drops its subscription on unmount', async () => {
        await mountAdapter()
        expect(listeners.get(EVENT)?.size).toBe(1)

        await mounted!.unmount()
        mounted = null
        expect(listeners.get(EVENT)?.size ?? 0).toBe(0)
    })
})

const hideButton = () =>
    mounted!.container.querySelector('.blocks-layer-manager__hide-filtered')

describe('MMGISLayerManagerAdapter filtered-out layers', () => {
    test('offers to hide the layers on the map that the list leaves out, naming them on hover', async () => {
        listed = { [SPARSE]: false }
        await mountAdapter()
        expect(hideButton()?.textContent).toBe('Hide 1 filtered-out layer')
        expect(hideButton()?.getAttribute('title')).toBe('Switch off: Sparse')
    })

    test('withdraws the offer when the list changes to leave nothing out', async () => {
        listed = { [SPARSE]: false, [CONTINUOUS]: false }
        await mountAdapter()
        expect(hideButton()?.textContent).toBe('Hide 2 filtered-out layers')
        expect(hideButton()?.getAttribute('title')).toBe('Switch off: Sparse, Continuous')

        listed = {}
        await emit('layer:listedChange')
        await settle()
        expect(hideButton()).toBeNull()
    })
})

const FORECAST = 'Forecast_0011223344556677'
const NEWEST = '2026-09-21T12:00:00'
const OLDER = '2026-09-21T06:00:00'

describe('MMGISLayerManagerAdapter model runs', () => {
    const runSelect = () =>
        mounted!.container.querySelector<HTMLSelectElement>('.blocks-layer-legend__run-select')
    const leadReadout = () =>
        mounted!.container.querySelector('.blocks-layer-legend__run-lead')

    beforeEach(() => {
        configs[FORECAST] = { display_name: 'NAQFC O3', time: { enabled: true } }
        visible[FORECAST] = true
        runsAnswer = {
            [FORECAST]: { runs: [NEWEST, OLDER], selected: NEWEST, step: 'PT1H', lead: 12 },
        }
    })

    test('offers the runs core reports, pinned where core pinned them, with the lead', async () => {
        await mountAdapter()
        expect(Array.from(runSelect()!.options).map((o) => o.value)).toEqual([NEWEST, OLDER])
        expect(runSelect()!.value).toBe(NEWEST)
        expect(leadReadout()!.textContent).toBe('+12 h')
        expect(configWrites).toEqual([])
    })

    test('a pick is one request to core', async () => {
        await mountAdapter()
        const select = runSelect()!
        select.value = OLDER
        await act(async () => {
            select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        expect(runRequests).toEqual([{ layerUUID: FORECAST, run: OLDER }])
        expect(configWrites).toEqual([])
    })

    test('follows a run change core announces', async () => {
        await mountAdapter()
        runsAnswer[FORECAST] = { ...runsAnswer[FORECAST], selected: OLDER }
        await emit('layer:runChange', { layerName: FORECAST, run: OLDER })
        await settle()
        expect(runSelect()!.value).toBe(OLDER)
    })

    test('re-reads the lead when the clock moves, without rebuilding the rows', async () => {
        await mountAdapter()
        const before = configReads
        runsAnswer[FORECAST] = { ...runsAnswer[FORECAST], lead: 30 }
        await emit('time:changed', { currentTime: '2026-09-22T18:00:00Z' })
        await settle()
        expect(leadReadout()!.textContent).toBe('+30 h')
        expect(configReads).toBe(before)
    })

    test('a layer core reports no runs for has no run control', async () => {
        runsAnswer = {}
        await mountAdapter()
        expect(runSelect()).toBeNull()
    })
})
