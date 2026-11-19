import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeComparisonUrlState } from '../adapters/urlState'

/**
 * The tool wrapper is the plugin's front door. Both entry points into it — the
 * layers list's "Compare layer" kebab entry and the timeline's "Compare date"
 * action — arrive as bus events carrying what to compare and which tab to open
 * on. A hand-off that lands while the panel is already open must reach it too,
 * rather than being swallowed as a repeat.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const CONTAINER_ID = 'comparison-panel-container'

type Request = { name: string; params?: unknown }

let listeners: Record<string, ((payload?: unknown) => void)[]>
let requests: Request[]
/** The wrapper's props from its last render of the panel adapter. */
let adapterProps: any
let ComparisonTool: any
/** What the opening link said about this tool, as core would answer it. */
let linkEntry: string | null = null

const load = async () => {
    vi.resetModules()
    listeners = {}
    requests = []
    adapterProps = null

    ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
        request: async (name: string, params?: unknown) => {
            requests.push({ name, params })
            if (name === 'url:takePluginState') return linkEntry
            return { ok: true, state: 'visible', changed: true }
        },
        hasHandler: () => true,
        on: (event: string, handler: (payload?: unknown) => void) => {
            ;(listeners[event] ||= []).push(handler)
            return () => {}
        },
        emit: () => {},
    }

    vi.doMock('../MMGISComparisonAdapter', () => ({
        MMGISComparisonAdapter: (props: any) => {
            adapterProps = props
            return null
        },
    }))

    ComparisonTool = (await import('../ComparisonTool')).default
}

/** Fires one bus event the way core's emitter would. */
const fire = (event: string, payload?: unknown) => {
    act(() => {
        ;(listeners[event] ?? []).forEach((handler) => handler(payload))
    })
}

const open = async () => {
    await act(async () => {
        ComparisonTool.make(CONTAINER_ID)
    })
}

const requested = (name: string) => requests.filter((r) => r.name === name)

describe('ComparisonTool hand-offs', () => {
    let container: HTMLElement

    beforeEach(async () => {
        container = document.createElement('div')
        container.id = CONTAINER_ID
        document.body.appendChild(container)
        await load()
    })

    afterEach(() => {
        act(() => ComparisonTool.destroy())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    test('a date hand-off with no panel yet asks the loader for one', async () => {
        fire('plugin:comparison:startWithDates')

        expect(requested('plugins:show')).toEqual([
            { name: 'plugins:show', params: { pluginId: 'ComparisonTool' } },
        ])
    })

    test('the panel it opens starts on the dates tab', async () => {
        fire('plugin:comparison:startWithDates')
        await open()

        expect(adapterProps.seedMode?.mode).toBe('dates')
    })

    test('a date hand-off moves an open panel to the dates tab in place', async () => {
        await open()

        fire('plugin:comparison:startWithDates')

        expect(adapterProps.seedMode?.mode).toBe('dates')
    })

    test('a hand-off to a mounted panel still asks for it to be shown', async () => {
        await open()
        const before = requested('plugins:show').length

        fire('plugin:comparison:startWithDates')

        expect(requested('plugins:show').length).toBe(before + 1)
    })

    /**
     * The panel can be moved off the dates tab by hand between two clicks of
     * the timeline's action, so the second click has to reach it as its own
     * request rather than as a repeat of a state the panel no longer holds.
     */
    test('asking for the dates tab twice reaches the panel each time', async () => {
        fire('plugin:comparison:startWithDates')
        await open()
        const first = adapterProps.seedMode

        fire('plugin:comparison:startWithDates')

        expect(adapterProps.seedMode).not.toBe(first)
        expect(adapterProps.seedMode?.mode).toBe('dates')
    })

    test('a layer hand-off seeds that layer and opens the layers tab', async () => {
        fire('plugin:comparison:startWithLayer', { layerId: 'co2' })
        await open()

        expect(adapterProps.seedLayerId).toBe('co2')
        expect(adapterProps.seedMode?.mode).toBe('layers')
    })

    test('closing unloads the plugin so the next hand-off re-mounts a panel', async () => {
        fire('plugin:comparison:startWithDates')
        await open()

        await act(async () => {
            adapterProps.onClose()
        })

        expect(requested('plugins:setState')).toEqual([
            {
                name: 'plugins:setState',
                params: { pluginId: 'ComparisonTool', state: 'unloaded' },
            },
        ])
    })
})

/**
 * The opening link's entry is read once, when the tool handlers come up, and
 * handed to the first panel. It does not survive a close: a panel re-mounted
 * from "Compare layer" starts from that hand-off, not from the link.
 */
describe('ComparisonTool link reopen', () => {
    let container: HTMLElement

    const LINK = {
        mode: 'layers' as const,
        layout: 'sideBySide' as const,
        leftLayerId: 'co2',
        rightLayerId: 'roads',
        compareDate: null,
        swapped: true,
        dividerPos: 0.3,
    }

    beforeEach(async () => {
        container = document.createElement('div')
        container.id = CONTAINER_ID
        document.body.appendChild(container)
        linkEntry = encodeComparisonUrlState(LINK)
        await load()
    })

    afterEach(() => {
        act(() => ComparisonTool.destroy())
        container.remove()
        linkEntry = null
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    test('asks core to show the panel and seeds it with the link', async () => {
        await open()

        expect(requested('plugins:show')).toHaveLength(1)
        expect(adapterProps.seedUrlState).toEqual(LINK)
        expect(adapterProps.seedMode?.mode).toBe('layers')
    })

    test('a panel re-mounted after close gets no link state', async () => {
        await open()
        await act(async () => {
            adapterProps.onClose()
        })
        act(() => ComparisonTool.destroy())

        fire('plugin:comparison:startWithLayer', { layerId: 'ch4' })
        await open()

        expect(adapterProps.seedUrlState).toBeNull()
        expect(adapterProps.seedLayerId).toBe('ch4')
    })
})

/**
 * The link learns the arrangement from the tool, never by asking it: every
 * change is pushed as it happens, with the divider as last dragged, and a
 * close pushes nothing so the next link carries no comparison.
 */
describe('ComparisonTool link push', () => {
    let container: HTMLElement

    const STATE = {
        mode: 'layers' as const,
        layout: 'swipe' as const,
        leftLayerId: 'co2',
        rightLayerId: 'roads',
        compareDate: null,
        swapped: false,
        dividerPos: 0.5,
    }

    const pushed = () => requested('url:setPluginState').map((r) => (r.params as any).value)
    const last = (values: unknown[]) => values[values.length - 1]

    beforeEach(async () => {
        container = document.createElement('div')
        container.id = CONTAINER_ID
        document.body.appendChild(container)
        await load()
    })

    afterEach(() => {
        act(() => ComparisonTool.destroy())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    test('pushes the arrangement as it changes, with the divider as last dragged', async () => {
        await open()
        await act(async () => {
            adapterProps.onUrlStateChange(STATE)
        })
        expect(last(pushed())).toBe(encodeComparisonUrlState(STATE))

        fire('map:comparison:dividerMoved', { position: 0.3 })
        expect(last(pushed())).toBe(encodeComparisonUrlState({ ...STATE, dividerPos: 0.3 }))
        expect(requested('url:setPluginState').every((r) => (r.params as any).pluginId === 'ComparisonTool')).toBe(true)
    })

    test('closing clears the slot', async () => {
        await open()
        await act(async () => {
            adapterProps.onUrlStateChange(STATE)
        })
        await act(async () => {
            adapterProps.onClose()
        })
        expect(last(pushed())).toBeNull()
    })
})
