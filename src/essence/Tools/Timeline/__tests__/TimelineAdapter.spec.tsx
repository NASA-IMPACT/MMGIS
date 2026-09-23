import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineAdapter } from '../TimelineAdapter'

/**
 * The "Compare date" action is a hand-off, not a call: the timeline knows the
 * Comparison plugin only by the name of the event it announces. Covered here:
 * the action is offered, clicking it puts that event on the bus, and the
 * event carries the window.
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
 * Where a layer row's navigation controls put the timeline. Reaching a layer's
 * data can mean leaving the window on screen, so the window follows the target
 * out instead of clamping it back in, moving only the edge that has to move.
 */

// jsdom has no ResizeObserver; the view constructs one to follow the chart
// area's width. The stub reports no size, leaving the starting width.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

// Three scattered days — one before the window, one inside, one past its end
// — so first/next/last each land differently against it.
const BEFORE_WINDOW = '2023-11-05T23:59:59.999Z'
// The window opens on the whole of the day a backwards stop names, so the bar
// drawn over that day sits inside the chart rather than against its left edge.
const BEFORE_WINDOW_DAY_START = '2023-11-05T00:00:00.000Z'
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

type Listener = (payload?: unknown) => void

/**
 * A core whose visible-layer answer can change between requests, and whose
 * bus subscriptions are kept so a test can fire them. Visibility is read
 * afresh on every request, so flipping a flag and firing the change event is
 * what revealing a layer looks like from the plugin's side.
 */
const installSparseApi = (
    emits: Emit[],
    visible: Record<string, boolean>,
    listeners: Record<string, Listener>
) => {
    ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
        request: async (name: string) => {
            if (name === 'time:isEnabled') return true
            if (name === 'time:getStart') return START
            if (name === 'time:getEnd') return END
            if (name === 'time:getCurrent') return CURRENT
            if (name === 'tool:getVars') return {}
            if (name === 'layers:getAllConfigs') return LAYER_CONFIGS
            if (name === 'layers:getVisible') return { ...visible }
            return null
        },
        hasHandler: () => true,
        on: (event: string, handler: Listener) => {
            listeners[event] = handler
            return () => {}
        },
        emit: (event: string, payload?: unknown) => {
            emits.push({ event, payload })
        },
    }
}

const autoFitToggle = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>(
        '[aria-label="Auto-fit to visible layers"]'
    )

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

        // Auto-fit is armed at load, and the sparse layer's dates straddle
        // the seeded window, so with the layer visible from the start the
        // fit would open the window onto those dates before any row control
        // could. The layer is revealed only once auto-fit is disarmed, which
        // leaves the seeded window for a control to reach past.
        const visible = { sparse: false, basemap: true }
        const listeners: Record<string, Listener> = {}
        installSparseApi(emits, visible, listeners)

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
        // The layer configs arrive a request later than the first render.
        await act(async () => {})

        act(() => {
            autoFitToggle(container)!.click()
        })
        visible.sparse = true
        await act(async () => {
            listeners['layer:visibilityChange']?.()
        })
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

    test('with auto-fit disarmed, a layer revealed beyond the window leaves it be', () => {
        expect(autoFitToggle(container)!.getAttribute('aria-pressed')).toBe(
            'false'
        )
        expect(requests()).toHaveLength(0)
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

    test('a target before the start opens the start onto its whole day, and only the start', () => {
        act(() => {
            navButton('first date')!.click()
        })

        expect(requests()[0].payload).toEqual({
            startTime: BEFORE_WINDOW_DAY_START,
            endTime: new Date(END).toISOString(),
            currentTime: BEFORE_WINDOW,
        })
    })

    test('a step back onto an earlier stop opens the window past that day\'s midnight', () => {
        // The stop the current time steps back to is the one before the
        // window, so the press both moves and widens.
        act(() => {
            navButton('previous date')!.click()
        })

        const { startTime, currentTime } = requests()[0].payload as {
            startTime: string
            currentTime: string
        }
        expect(currentTime).toBe(BEFORE_WINDOW)
        expect(new Date(startTime).getTime()).toBeLessThanOrEqual(
            new Date(BEFORE_WINDOW_DAY_START).getTime()
        )
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

/**
 * The zoom group lives in the toolbar, and a fit that reaches data outside
 * the global window opens the window through the same request path the row
 * controls use. Auto-fit is armed at load, so the sparse layer's dates, which
 * straddle the seeded window, widen it the moment the layer arrives.
 */
describe('TimelineAdapter zoom wiring', () => {
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
        installSparseApi(emits, { sparse: true, basemap: true }, {})

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
        await act(async () => {})
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver
    })

    const requests = () => emits.filter((e) => e.event === 'time:changeRequested')

    test('offers the zoom group in the toolbar', () => {
        expect(
            container.querySelector(
                '.timeline-toolbar [role="group"][aria-label="Zoom"]'
            )
        ).not.toBeNull()
        expect(autoFitToggle(container)!.getAttribute('aria-pressed')).toBe(
            'true'
        )
    })

    test('a fit reaching outside the global window widens it once, leaving the scrubber be', () => {
        expect(requests()).toHaveLength(1)
        expect(requests()[0].payload).toEqual({
            startTime: BEFORE_WINDOW,
            endTime: PAST_WINDOW,
            currentTime: new Date(CURRENT).toISOString(),
        })
    })

    test('the help popover covers the zoom controls', () => {
        act(() => {
            container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Timeline controls help"]'
                )!
                .click()
        })

        expect(
            document.querySelector('.timeline-info-tooltip-content')?.textContent
        ).toMatch(/zoom controls/i)
    })
})

/**
 * Until core answers, the adapter holds a placeholder window. The zoom state
 * exists from the first render, so it meets that placeholder before it meets
 * the seeded window; neither the view nor any commit may be derived from it.
 */
describe('TimelineAdapter zoom before and at the seed', () => {
    let container: HTMLElement
    let root: Root
    let emits: Emit[]
    let originalResizeObserver: unknown

    const slider = () =>
        container.querySelector<HTMLInputElement>('.timeline-zoom-slider')

    const requests = () => emits.filter((e) => e.event === 'time:changeRequested')

    /**
     * Mounts with the given layers visible. The seed can be held back behind
     * `releaseSeed` so the layers land first.
     */
    const mount = async (
        visible: Record<string, boolean>,
        holdSeed: boolean
    ): Promise<() => void> => {
        let releaseSeed: () => void = () => {}
        const seedGate = new Promise<void>((resolve) => {
            releaseSeed = resolve
        })
        installSparseApi(emits, visible, {})
        const api = (window as unknown as {
            mmgisAPI: { request: (name: string) => Promise<unknown> }
        }).mmgisAPI
        const request = api.request
        api.request = async (name: string) => {
            if (holdSeed && name === 'time:getStart') await seedGate
            return request(name)
        }

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
        await act(async () => {})
        return releaseSeed
    }

    beforeEach(() => {
        emits = []
        originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
            .ResizeObserver
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            NoopResizeObserver
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver
    })

    test('with nothing to fit, the view opens on the whole seeded window', async () => {
        await mount({ basemap: true }, false)

        expect(slider()!.value).toBe('0')
        expect(requests()).toHaveLength(0)
    })

    test('layers arriving ahead of the seed commit nothing until it lands', async () => {
        const releaseSeed = await mount({ sparse: true, basemap: true }, true)

        expect(container.querySelector('.timeline-loading')).not.toBeNull()
        expect(requests()).toHaveLength(0)

        await act(async () => {
            releaseSeed()
        })
        await act(async () => {})

        // The one widen frames the layer against the seeded window, never
        // the placeholder.
        expect(requests()).toHaveLength(1)
        expect(requests()[0].payload).toEqual({
            startTime: BEFORE_WINDOW,
            endTime: PAST_WINDOW,
            currentTime: new Date(CURRENT).toISOString(),
        })
    })
})

/**
 * A layer's authored data times can be open-ended ("now", a duration offset,
 * a cadence to floor to). Core resolves those; the timeline draws and
 * navigates the resolved dates rather than re-reading the config itself.
 */

// Where core says a daily layer authored as ending "now" actually ends: its
// last complete day, well inside the window and nowhere near the clock.
const FLOORED_END = '2024-09-30T00:00:00.000Z'
const AUTHORED_START = '2024-03-01T00:00:00.000Z'

const OPEN_ENDED_CONFIGS = {
    daily: {
        name: 'daily',
        display_name: 'Daily Product',
        time: {
            enabled: true,
            dataStartTime: AUTHORED_START,
            dataEndTime: 'now',
            interval: 'P1D',
        },
    },
}

describe('TimelineAdapter open-ended layer time', () => {
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
                if (name === 'layers:getAllConfigs') return OPEN_ENDED_CONFIGS
                if (name === 'layers:getVisible') return { daily: true }
                if (name === 'layers:getTemporalExtent')
                    return { daily: { start: AUTHORED_START, end: FLOORED_END } }
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
        await act(async () => {})
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver
    })

    const requests = () => emits.filter((e) => e.event === 'time:changeRequested')

    test('the last date of a layer ending "now" is where core floored it, not the clock', () => {
        act(() => {
            container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="Daily Product: last date"]'
                )!
                .click()
        })

        expect(requests()).toHaveLength(1)
        expect(requests()[0].payload).toEqual({
            startTime: new Date(START).toISOString(),
            endTime: new Date(END).toISOString(),
            currentTime: FLOORED_END,
        })
    })
})
