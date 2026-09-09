import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineAdapter } from '../TimelineAdapter'

/**
 * The timeline's "Compare date" action is a hand-off, not a call: the timeline
 * knows nothing about the Comparison plugin beyond the name of the event it
 * announces, and a mission without that plugin is simply one where nobody
 * listens. What is covered here is that the action is offered at all, that
 * clicking it puts that event on the bus, and that it carries the window.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const START = '2024-01-01T00:00:00Z'
const END = '2024-12-31T00:00:00Z'
const CURRENT = '2024-06-15T00:00:00Z'

type Emit = { event: string; payload?: unknown }

describe('TimelineAdapter compare hand-off', () => {
    let container: HTMLElement
    let root: Root
    let emits: Emit[]

    beforeEach(async () => {
        emits = []
        ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
            request: async (name: string) => {
                if (name === 'time:isEnabled') return true
                if (name === 'time:getStart') return START
                if (name === 'time:getEnd') return END
                if (name === 'time:getCurrent') return CURRENT
                if (name === 'tool:getVars') return {}
                return null
            },
            hasHandler: (name: string) => name !== 'layers:getAllConfigs',
            on: () => () => {},
            emit: (event: string, payload?: unknown) => {
                emits.push({ event, payload })
            },
        }

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    const compareButton = () =>
        container.querySelector<HTMLButtonElement>('.compare-date-button')

    test('offers the compare action beside the date', () => {
        expect(compareButton()).not.toBeNull()
    })

    const handOffs = () =>
        emits.filter((e) => e.event === 'plugin:comparison:startWithDates')

    test('clicking it announces the hand-off on the bus', () => {
        act(() => {
            compareButton()!.click()
        })

        expect(handOffs()).toHaveLength(1)
    })

    test('the hand-off carries the timeline window it is named for', () => {
        act(() => {
            compareButton()!.click()
        })

        // The Date round trip normalizes these, as it does for any commit.
        expect(handOffs()[0].payload).toEqual({
            startTime: new Date(START).toISOString(),
            endTime: new Date(END).toISOString(),
            currentTime: new Date(CURRENT).toISOString(),
        })
    })
})

/**
 * Where a layer row's navigation controls put the timeline.
 *
 * A layer holds data where it holds it, so reaching that data can mean leaving
 * the window on screen. What is covered here is that the window follows the
 * target out instead of clamping it back in, and that it moves only the edge
 * that has to move.
 */

// jsdom has no ResizeObserver; the timeline view constructs one to follow the
// width of the chart area. The stub never reports a size, leaving the view on
// the starting width it lays the SVG out with.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// Data on three scattered days: one before the window, one inside it, one
// past its end — so first/next/last each land somewhere different relative to
// the window. A stop closes the day it names.
const BEFORE_WINDOW = '2023-11-05T23:59:59.999Z'
const INSIDE_WINDOW = '2024-06-20T23:59:59.999Z'
const PAST_WINDOW = '2025-03-20T23:59:59.999Z'

const LAYER_CONFIGS = {
    sparse: {
        name: 'sparse',
        display_name: 'Rover Images',
        time: {
            enabled: true,
            dataDates: ['2023-11-05', '2024-06-20', '2025-03-20'],
        },
    },
    basemap: {
        name: 'basemap',
        display_name: 'Basemap',
        time: { enabled: false },
    },
}

describe('TimelineAdapter layer navigation', () => {
    let container: HTMLElement
    let root: Root
    let emits: Emit[]
    let originalResizeObserver: unknown

    beforeEach(async () => {
        emits = []
        originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
            .ResizeObserver
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            NoopResizeObserver
        ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
            request: async (name: string) => {
                if (name === 'time:isEnabled') return true
                if (name === 'time:getStart') return START
                if (name === 'time:getEnd') return END
                if (name === 'time:getCurrent') return CURRENT
                if (name === 'tool:getVars') return {}
                if (name === 'layers:getAllConfigs') return LAYER_CONFIGS
                if (name === 'layers:getVisible')
                    return { sparse: true, basemap: true }
                return null
            },
            hasHandler: () => true,
            on: () => () => {},
            emit: (event: string, payload?: unknown) => {
                emits.push({ event, payload })
            },
        }

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
        // The layer configs arrive a request later than the first render.
        await act(async () => {})
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver
    })

    const navButton = (name: string) =>
        container.querySelector<HTMLButtonElement>(
            `[aria-label="Rover Images: ${name}"]`
        )

    const requests = () => emits.filter((e) => e.event === 'time:changeRequested')

    test('gives the rows of layers that carry dates their own controls', () => {
        expect(navButton('next date')).not.toBeNull()
        // Nothing of the basemap's own to move through.
        expect(
            container.querySelector('[aria-label^="Basemap:"]')
        ).toBeNull()
    })

    test('a target inside the window commits it and leaves the window be', () => {
        act(() => {
            navButton('next date')!.click()
        })

        expect(requests()).toHaveLength(1)
        expect(requests()[0].payload).toEqual({
            startTime: new Date(START).toISOString(),
            endTime: new Date(END).toISOString(),
            currentTime: INSIDE_WINDOW,
        })
    })

    test('a target past the end widens the end onto it, and only the end', () => {
        act(() => {
            navButton('last date')!.click()
        })

        expect(requests()[0].payload).toEqual({
            startTime: new Date(START).toISOString(),
            endTime: PAST_WINDOW,
            currentTime: PAST_WINDOW,
        })
    })

    test('a target before the start widens the start onto it, and only the start', () => {
        act(() => {
            navButton('first date')!.click()
        })

        expect(requests()[0].payload).toEqual({
            startTime: BEFORE_WINDOW,
            endTime: new Date(END).toISOString(),
            currentTime: BEFORE_WINDOW,
        })
    })

    test('the help popover says the layer rows carry controls', () => {
        act(() => {
            container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Timeline controls help"]'
                )!
                .click()
        })

        expect(
            document.querySelector('.timeline-info-tooltip-content')?.textContent
        ).toMatch(/layer/i)
    })
})
