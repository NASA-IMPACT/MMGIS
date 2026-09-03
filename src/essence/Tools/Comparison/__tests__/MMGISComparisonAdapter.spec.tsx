import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The adapter is where a picked date becomes a split map. What matters is what
 * it asks core for: which layers each side draws, which side carries the pinned
 * date, and that the primary side carries none so it keeps following the
 * timeline.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

type Layer = { id: string; title: string }

const LAYERS: Layer[] = [
    { id: 'co2', title: 'CO₂' },
    { id: 'roads', title: 'Roads' },
    { id: 'ch4', title: 'CH₄' },
]

const WINDOW_START = new Date('2024-01-01T00:00:00Z')
const WINDOW_END = new Date('2024-12-31T00:00:00Z')
const PRIMARY = new Date('2024-10-31T14:30:00Z')
const COMPARE = new Date('2024-06-15T00:00:00Z')

let enableCalls: any[]
let disableCalls: number
let setCurrentCalls: Date[]
/** Enables and disables in the order core received them. */
let order: string[]
/** Every re-wording of the two sides core was asked for. */
let labelCalls: any[]
/** What the visible-layer hook reports; reassign to simulate a layer event. */
let visibleLayers: Layer[]
/** Whether that hook has read yet; set false to model the gap before it has. */
let layersRead: boolean
/** Where the global timeline sits; reassign to simulate it moving. */
let globalCurrent: Date
let globalReadiness: 'loading' | 'ready' | 'unavailable'
let MMGISComparisonAdapter: any
/** The panel's props from its last render, used to drive it from outside. */
let panelProps: any

/** The most recent enable, i.e. what the map is currently drawing. */
const lastEnable = () => enableCalls[enableCalls.length - 1]

/** What the map is currently calling the two sides. */
const lastLabels = () => labelCalls[labelCalls.length - 1]

const load = async () => {
    vi.resetModules()
    enableCalls = []
    disableCalls = 0
    labelCalls = []
    setCurrentCalls = []
    order = []
    visibleLayers = LAYERS
    layersRead = true
    globalCurrent = PRIMARY
    globalReadiness = 'ready'
    panelProps = null

    vi.doMock('../adapters/handlers', () => ({
        enableComparison: async (config: unknown) => {
            enableCalls.push(config)
            order.push('enable')
        },
        disableComparison: async () => {
            disableCalls += 1
            order.push('disable')
        },
        setComparisonLabels: async (labels: unknown) => {
            labelCalls.push(labels)
            order.push('labels')
        },
    }))
    vi.doMock('../adapters/useVisibleLayers', () => ({
        useVisibleLayers: () => ({ layers: visibleLayers, read: layersRead }),
    }))
    vi.doMock('../adapters/useGlobalTime', () => ({
        useGlobalTime: () => ({
            enabled: globalReadiness === 'ready',
            readiness: globalReadiness,
            start: WINDOW_START,
            end: WINDOW_END,
            current: globalCurrent,
            setCurrent: (date: Date) => { setCurrentCalls.push(date) },
        }),
    }))
    vi.doMock('../lib', () => ({
        ComparisonPanel: (props: any) => {
            panelProps = props
            return null
        },
    }))

    MMGISComparisonAdapter = (await import('../MMGISComparisonAdapter'))
        .MMGISComparisonAdapter
}

describe('MMGISComparisonAdapter dates mode', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(async () => {
        await load()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })
        await act(async () => { panelProps.onModeChange('dates') })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    test('waits for a second date before splitting the map', () => {
        expect(enableCalls).toEqual([])
    })

    test('a picked date splits every visible layer across the two dates', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })

        expect(lastEnable()).toEqual({
            leftLayers: ['co2', 'roads', 'ch4'],
            rightLayers: ['co2', 'roads', 'ch4'],
            leftDate: null,
            rightDate: COMPARE.toISOString(),
            leftLabel: 'Oct 31, 2024',
            rightLabel: 'Jun 15, 2024',
            layout: 'swipe',
        })
    })

    // The map says which date each half is showing, in UTC and in the wording
    // the panel's own date rows use.
    test('names each half of the map for the date it is showing', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })

        expect(lastLabels()).toEqual({
            left: 'Oct 31, 2024',
            right: 'Jun 15, 2024',
        })
    })

    // Moving the timeline is exactly the case a re-enable must not serve, so
    // the caption is re-worded on its own.
    test('the timeline moving re-words the primary caption without re-enabling', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })
        const enablesBefore = enableCalls.length

        globalCurrent = new Date('2024-09-02T00:00:00Z')
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })

        expect(enableCalls.length).toBe(enablesBefore)
        expect(lastLabels()).toEqual({
            left: 'Sep 2, 2024',
            right: 'Jun 15, 2024',
        })
    })

    test('swapping moves the pinned date to the other side', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })
        await act(async () => { panelProps.onSwap() })

        expect(lastEnable().leftDate).toBe(COMPARE.toISOString())
        expect(lastEnable().rightDate).toBeNull()
    })

    test('the primary date moves the timeline rather than pinning a side', async () => {
        const next = new Date('2024-03-01T00:00:00Z')
        await act(async () => { panelProps.onPrimaryDateChange(next) })

        expect(setCurrentCalls).toEqual([next])
    })

    /**
     * Core reloads the time-enabled layers when the timeline moves and carries
     * that through to both sides itself. Re-enabling from here on the same
     * event would clone those layers before the reload had finished, so the
     * global instant must stay out of the sides computation.
     */
    test('the timeline moving does not re-enable the split', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })
        const before = enableCalls.length

        globalCurrent = new Date('2024-11-30T00:00:00Z')
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })

        expect(panelProps.primaryDate).toBe(globalCurrent)
        expect(enableCalls.length).toBe(before)
    })

    /**
     * The visible-layer hook hands back a fresh array on every layer event even
     * when the set is identical, which must not re-clone both sides.
     */
    test('an unchanged layer set does not re-enable the split', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })
        const before = enableCalls.length

        visibleLayers = LAYERS.map((layer) => ({ ...layer }))
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })

        expect(enableCalls.length).toBe(before)
    })

    /**
     * A timeline that has not answered yet and a mission with no timeline at
     * all reach the panel as different states, so it can say "reading the
     * timeline" instead of claiming the map has none.
     */
    test('reports how the timeline read back rather than only whether it did', async () => {
        expect(panelProps.timeStatus).toBe('ready')

        globalReadiness = 'loading'
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })
        expect(panelProps.timeStatus).toBe('loading')

        globalReadiness = 'unavailable'
        await act(async () => {
            root.render(<MMGISComparisonAdapter />)
        })
        expect(panelProps.timeStatus).toBe('unavailable')
    })

    test('leaving the dates tab tears the split down', async () => {
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })
        const before = disableCalls
        await act(async () => { panelProps.onModeChange('layers') })

        expect(disableCalls).toBe(before + 1)
    })
})

describe('MMGISComparisonAdapter layers mode', () => {
    let container: HTMLElement
    let root: Root
    let unmounted: boolean

    beforeEach(async () => {
        await load()
        unmounted = false
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="co2" />)
        })
    })

    afterEach(() => {
        if (!unmounted) act(() => root.unmount())
        container.remove()
    })

    test('still compares one chosen layer per side', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })

        expect(lastEnable()).toEqual({
            leftLayers: ['co2'],
            rightLayers: ['roads'],
            leftDate: null,
            rightDate: null,
            leftLabel: 'CO₂',
            rightLabel: 'Roads',
            layout: 'swipe',
        })
    })

    // The map names each half by the layer's title, not the id the dropdown
    // carries, since the title is what the user picked it by.
    test('names each half of the map for the layer it is drawing', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })

        expect(lastLabels()).toEqual({ left: 'CO₂', right: 'Roads' })
    })

    // Swap moves the choices across the divider, so the captions cross with
    // them and each one stays over the half it names.
    test('swapping crosses the captions with the sides', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        await act(async () => { panelProps.onSwap() })

        expect(lastLabels()).toEqual({ left: 'Roads', right: 'CO₂' })
    })

    /** A second kebab click re-seeds the panel that is already open. */
    test('re-seeding replaces the first side', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="ch4" />)
        })

        expect(lastEnable().leftLayers).toEqual(['ch4'])
        expect(lastEnable().rightLayers).toEqual(['roads'])
    })

    test('unmounting while active tears the split down', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        const before = disableCalls

        act(() => root.unmount())
        unmounted = true

        expect(disableCalls).toBe(before + 1)
    })

    test('closing stops the comparison before unloading the plugin', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        await act(async () => {
            root.render(
                <MMGISComparisonAdapter
                    seedLayerId="co2"
                    onClose={() => { order.push('close') }}
                />,
            )
        })
        await act(async () => { panelProps.onClose() })

        expect(order.slice(-2)).toEqual(['disable', 'close'])
    })

    /**
     * The plugin loader unmounts this root after `onClose` returns, so a layer
     * event can still land on a closed panel. It must not put the comparison
     * back on the map.
     */
    test('a layer event after closing does not re-engage the map', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        await act(async () => { panelProps.onClose() })
        const before = enableCalls.length

        visibleLayers = [...LAYERS, { id: 'no2', title: 'NO₂' }]
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="co2" />)
        })

        expect(enableCalls.length).toBe(before)
    })

    /**
     * Otherwise the panel names a layer the map is not drawing: dropping the
     * selected option leaves the select on its first enabled one, and that
     * silent move fires no change event for the state behind it to follow.
     */
    test('a side gives up a layer that stops being drawn', async () => {
        await act(async () => { panelProps.onRightLayerChange('roads') })
        const before = disableCalls

        visibleLayers = LAYERS.filter((layer) => layer.id !== 'co2')
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="co2" />)
        })

        expect(panelProps.leftLayerId).toBeNull()
        expect(panelProps.rightLayerId).toBe('roads')
        expect(disableCalls).toBe(before + 1)
    })

    /**
     * An empty list before the first read says nothing about what the map
     * draws, so the seed the kebab entry just handed over survives that gap.
     */
    test('keeps the seed until the layer list has been read', async () => {
        layersRead = false
        visibleLayers = []
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="co2" />)
        })

        expect(panelProps.leftLayerId).toBe('co2')
    })
})

/**
 * Which tab the panel opens on is decided by whichever entry point started the
 * comparison — the layers list asks for the layer tab, the timeline for the
 * date tab — and the panel adopts a later request the same way it adopts a
 * later seed layer.
 */
describe('MMGISComparisonAdapter tab seeding', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(async () => {
        await load()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = async (props: Record<string, unknown> = {}) => {
        await act(async () => {
            root.render(<MMGISComparisonAdapter {...props} />)
        })
    }

    test('opens on the layers tab when no entry point asked for one', async () => {
        await render()
        expect(panelProps.mode).toBe('layers')
    })

    test('opens on the tab the entry point asked for', async () => {
        await render({ seedMode: { mode: 'dates' } })
        expect(panelProps.mode).toBe('dates')
    })

    test('adopts a later request for the other tab', async () => {
        await render({ seedMode: { mode: 'layers' } })
        await render({ seedMode: { mode: 'dates' } })
        expect(panelProps.mode).toBe('dates')
    })

    /**
     * A repeat of the same request is a fresh click on the same entry point,
     * and the user may have moved the panel off that tab in between, so it puts
     * them back rather than being read as a state the panel already holds.
     */
    test('a repeated request re-opens the tab the user has since left', async () => {
        await render({ seedMode: { mode: 'dates' } })
        await act(async () => { panelProps.onModeChange('layers') })
        expect(panelProps.mode).toBe('layers')

        await render({ seedMode: { mode: 'dates' } })
        expect(panelProps.mode).toBe('dates')
    })

    test('leaves the tab where the user put it while no request arrives', async () => {
        const request = { mode: 'dates' }
        await render({ seedMode: request })
        await act(async () => { panelProps.onModeChange('layers') })

        await render({ seedMode: request })
        expect(panelProps.mode).toBe('layers')
    })
})

/**
 * Swapping reverses which side of the divider the two choices draw on. It is
 * one state across both tabs, because the panel offers one swap button: the
 * choices themselves — the two dropdowns, the two dates — stay exactly where
 * the user put them, and the button's pressed state is what reports that the
 * sides are reversed.
 */
describe('MMGISComparisonAdapter swapping', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(async () => {
        await load()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<MMGISComparisonAdapter seedLayerId="co2" />)
        })
        await act(async () => { panelProps.onRightLayerChange('roads') })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const swap = async () => {
        await act(async () => { panelProps.onSwap() })
    }

    test('draws each chosen layer on the other side of the divider', async () => {
        await swap()

        expect(lastEnable().leftLayers).toEqual(['roads'])
        expect(lastEnable().rightLayers).toEqual(['co2'])
    })

    test('leaves both dropdowns showing what the user chose', async () => {
        await swap()

        expect(panelProps.leftLayerId).toBe('co2')
        expect(panelProps.rightLayerId).toBe('roads')
    })

    test('tells the panel the sides are swapped', async () => {
        expect(panelProps.swapped).toBe(false)
        await swap()
        expect(panelProps.swapped).toBe(true)
    })

    test('swapping again puts the sides back', async () => {
        await swap()
        await swap()

        expect(panelProps.swapped).toBe(false)
        expect(lastEnable().leftLayers).toEqual(['co2'])
        expect(lastEnable().rightLayers).toEqual(['roads'])
    })

    /**
     * Nothing but the swap button reverses the sides, so a choice made while
     * swapped lands on the side the button says it will — anything else would
     * move the map without the user touching the control that moves it.
     */
    test('a layer picked while swapped draws on the swapped side', async () => {
        await swap()
        await act(async () => { panelProps.onLeftLayerChange('ch4') })

        expect(panelProps.swapped).toBe(true)
        expect(lastEnable().rightLayers).toEqual(['ch4'])
        expect(lastEnable().leftLayers).toEqual(['roads'])
    })

    // One button, one state: the tabs share it, so switching tabs neither
    // resets the sides nor leaves the button lit over a comparison it no longer
    // describes.
    test('carries the swap across a tab switch', async () => {
        await swap()
        await act(async () => { panelProps.onModeChange('dates') })
        await act(async () => { panelProps.onCompareDateChange(COMPARE) })

        expect(panelProps.swapped).toBe(true)
        expect(lastEnable().leftDate).toBe(COMPARE.toISOString())
        expect(lastEnable().rightDate).toBeNull()
    })
})
