import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { zoomTransform } from 'd3-zoom'

/**
 * How the sidebar carries a layer's navigation controls: which rows get them,
 * and where a press is delivered.
 *
 * The process timezone is pinned behind UTC, so a row resolving its target
 * locally surfaces as a wrong instant here rather than passing on a UTC host
 * and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import { TimelineView } from '../lib/geo/TimelineView/TimelineView'
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import { transformToWindow, type ViewWindow } from '../lib/utils/zoomWindow'
import type { LayerTimeData, TimeMode } from '../lib/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver; the view constructs one to follow the chart
// area's width. The stub reports no size, leaving the starting width.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const START = new Date('2020-01-01T00:00:00Z')
const END = new Date('2020-12-31T23:59:59.999Z')
const CURRENT = new Date('2020-05-01T00:00:00Z')

/** A sparse model whose stops close the listed days, as the resolver builds. */
const sparseNav = (...days: string[]): LayerNavigation => {
    const stops = days.map((day) => new Date(`${day}T23:59:59.999Z`))
    return {
        kind: 'sparse',
        stops,
        start: stops[0],
        end: stops[stops.length - 1],
        hasOwnStart: true,
        hasOwnEnd: true,
    }
}

const layer = (
    name: string,
    navigation?: LayerNavigation
): LayerTimeData => ({
    name,
    displayName: name,
    timeRanges: [{ start: START, end: END }],
    color: '#00b3c8',
    navigation,
})

describe('TimelineView layer navigation', () => {
    let container: HTMLElement
    let root: Root
    let navigated: Date[]
    let committed: Date[]
    let originalResizeObserver: unknown

    beforeEach(() => {
        originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
            .ResizeObserver
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            NoopResizeObserver

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        navigated = []
        committed = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver as typeof ResizeObserver
    })

    const render = (
        layers: LayerTimeData[],
        timeMode: TimeMode = 'DAY',
        currentTime = CURRENT
    ) => {
        act(() => {
            root.render(
                <TimelineView
                    startTime={START}
                    endTime={END}
                    currentTime={currentTime}
                    timeMode={timeMode}
                    configuredGranularity={timeMode}
                    layers={layers}
                    view={{ start: START, end: END }}
                    onViewChange={() => {}}
                    onCurrentTimeChange={(date) => committed.push(date)}
                    onLayerNavigate={(date) => navigated.push(date)}
                    onFitLayer={() => {}}
                />,
            )
        })
    }

    const rows = () =>
        Array.from(container.querySelectorAll<HTMLElement>('.layer-item'))

    const rowButtons = (index: number) =>
        Array.from(rows()[index].querySelectorAll<HTMLButtonElement>('button'))

    const press = (index: number, label: string) => {
        const button = rowButtons(index).find(
            (candidate) => candidate.getAttribute('aria-label') === label,
        )!
        // Dispatched rather than clicked: a control disabled in name only,
        // through aria-disabled, still delivers the event.
        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
    }

    test('gives a layer that carries a navigation model its controls', () => {
        // The row's full set of controls is the row's own concern; this only
        // checks the view hands it the layer, by a control named for it.
        render([layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02'))])

        expect(
            rowButtons(0).map((button) => button.getAttribute('aria-label')),
        ).toContain('MODIS Daily: next date')
    })

    test('leaves a layer with nothing to navigate without controls', () => {
        // A layer the resolver found no instant for carries no model, which
        // is what opts its row out.
        render([
            layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02')),
            layer('Basemap'),
        ])

        expect(rowButtons(0).length).toBeGreaterThan(0)
        expect(rowButtons(1)).toHaveLength(0)
    })

    test('reports the instant the pressed control leads to', () => {
        render([layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02'))])

        press(0, 'MODIS Daily: next date')

        expect(navigated.map((date) => date.toISOString())).toEqual([
            '2020-11-02T23:59:59.999Z',
        ])
    })

    test('moves a periodic layer by the granularity the timeline is on', () => {
        // A periodic layer steps by the timeline's granularity, so the landing
        // is a month on only because the view is in MONTH mode.
        render(
            [layer('Sea Surface Temperature', {
                kind: 'periodic',
                start: START,
                end: END,
                hasOwnStart: true,
                hasOwnEnd: true,
            })],
            'MONTH',
        )

        press(0, 'Sea Surface Temperature: next date')

        expect(navigated.map((date) => date.toISOString())).toEqual([
            '2020-06-01T00:00:00.000Z',
        ])
    })

    test('keeps a layer jump off the scrubber\'s commit path', () => {
        // The two paths treat the window differently, so a jump must not
        // arrive as though the scrubber had moved.
        render([layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02'))])

        press(0, 'MODIS Daily: first date')

        expect(navigated).toHaveLength(1)
        expect(committed).toEqual([])
    })

    test('keeps each sidebar row the height of the chart row beside it', () => {
        // The two columns share one pitch: a row drifting from its bar leaves
        // the sidebar naming the wrong layer.
        render([
            layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02')),
            layer('Basemap'),
        ])

        const chartRows = Array.from(
            container.querySelectorAll<SVGRectElement>('.layer-row-bg'),
        )

        expect(chartRows).toHaveLength(rows().length)
        rows().forEach((row, index) => {
            expect(row.style.height).toBe(
                `${chartRows[index].getAttribute('height')}px`,
            )
        })
    })
})

describe('TimelineView visible window', () => {
    let container: HTMLElement
    let root: Root
    let reported: ViewWindow[]
    let originalResizeObserver: unknown

    const FULL: ViewWindow = { start: START, end: END }

    beforeEach(() => {
        originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
            .ResizeObserver
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            NoopResizeObserver

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        reported = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
            originalResizeObserver as typeof ResizeObserver
    })

    const WEEK: ViewWindow = {
        start: new Date('2020-03-01T00:00:00Z'),
        end: new Date('2020-03-08T00:00:00Z'),
    }

    const render = (view: ViewWindow, bounds: ViewWindow = FULL) => {
        act(() => {
            root.render(
                <TimelineView
                    startTime={bounds.start}
                    endTime={bounds.end}
                    currentTime={CURRENT}
                    timeMode="DAY"
                    configuredGranularity="DAY"
                    layers={[layer('MODIS Daily', sparseNav('2020-01-02'))]}
                    view={view}
                    onViewChange={(next) => reported.push(next)}
                    onCurrentTimeChange={() => {}}
                    onLayerNavigate={() => {}}
                    onFitLayer={() => {}}
                />,
            )
        })
    }

    const chart = () =>
        container.querySelector<SVGSVGElement>('.timeline-svg-container > svg')!

    /** The scale factor d3 holds for the chart, read from its own state. */
    const heldScale = () => zoomTransform(chart()).k

    const spanOf = (win: ViewWindow) =>
        win.end.getTime() - win.start.getTime()

    /** The label text of every tick drawn on the bottom axis. */
    const axisLabels = () =>
        Array.from(
            container.querySelectorAll<SVGTextElement>(
                '.timeline-axis .tick text',
            ),
        ).map((text) => text.textContent)

    test('draws the axes over the window it is given', () => {
        render(FULL)
        const full = axisLabels()

        render(WEEK)

        expect(axisLabels()).not.toEqual(full)
        expect(axisLabels().length).toBeGreaterThan(0)
        // A week-wide window is labelled in days within March.
        expect(axisLabels().every((label) => label?.startsWith('Mar'))).toBe(true)
    })

    test('pushes the window into d3 without echoing it back', () => {
        // The window is pushed into d3 so its internal state stays in step,
        // which re-fires the zoom handler. The handler compares and skips.
        // d3's own scale is read back so a push that never lands cannot pass
        // this by leaving the handler unfired. Mounted straight onto the
        // narrow window, where identity would be wrong from the first frame.
        render(WEEK)
        expect(heldScale()).toBeCloseTo(spanOf(FULL) / spanOf(WEEK), 6)

        render(FULL)
        expect(heldScale()).toBe(1)

        render(WEEK)
        expect(heldScale()).toBeCloseTo(spanOf(FULL) / spanOf(WEEK), 6)

        expect(reported).toEqual([])
    })

    test('starts a rebuilt behaviour from the window held', () => {
        // Widening the bounds rebuilds the zoom behaviour. The window on
        // screen is unchanged, so d3 has to be told again where it is, and
        // the replacement's push must not read as a gesture.
        render(WEEK)
        const wider: ViewWindow = {
            start: new Date('2019-01-01T00:00:00Z'),
            end: END,
        }
        render(WEEK, wider)

        expect(heldScale()).toBeCloseTo(spanOf(wider) / spanOf(WEEK), 6)
        expect(reported).toEqual([])
    })

    test('leaves a drag open across a rebuild unable to move the window', () => {
        // The drag's window listeners outlive the behaviour they were bound
        // by and keep dispatching to it. Detached, they read nothing; still
        // attached, each move — and the replacement's own push — would be
        // read through the bounds and width the old handler closed over.
        const view = document.defaultView!
        // d3 binds a drag's move and release on `event.view`. jsdom's
        // MouseEvent constructor refuses the window as `view`, so it is set
        // on the event afterwards, as an own property the getter yields to.
        const mouse = (type: string, clientX: number) => {
            const event = new MouseEvent(type, {
                bubbles: true,
                clientX,
                clientY: 10,
            })
            Object.defineProperty(event, 'view', { value: view })
            return event
        }

        render(WEEK)
        act(() => {
            chart().dispatchEvent(mouse('mousedown', 400))
        })

        render(WEEK, { start: new Date('2019-01-01T00:00:00Z'), end: END })
        act(() => {
            view.dispatchEvent(mouse('mousemove', 420))
            view.dispatchEvent(mouse('mouseup', 420))
        })

        expect(reported).toEqual([])
    })

    test('reports the window a wheel gesture arrives at, anchored under the pointer', () => {
        // The one positive path from a gesture to the parent: d3's own event
        // pipeline, through the filter and the handler, to onViewChange. The
        // pointer sits a quarter of the way across the chart, so the instant
        // there is what the zoom has to hold still.
        render(FULL)
        act(() => {
            chart().dispatchEvent(
                new WheelEvent('wheel', {
                    deltaY: -100,
                    clientX: 200,
                    clientY: 10,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        })

        expect(reported).toHaveLength(1)
        const [next] = reported
        expect(spanOf(next)).toBeLessThan(spanOf(FULL))
        expect(next.start.getTime()).toBeGreaterThanOrEqual(START.getTime())
        expect(next.end.getTime()).toBeLessThanOrEqual(END.getTime())

        // Each endpoint is rounded to the millisecond on its own, so the
        // anchored instant can drift by up to half of one.
        const quarterIn = (win: ViewWindow) =>
            win.start.getTime() + spanOf(win) / 4
        expect(Math.abs(quarterIn(next) - quarterIn(FULL))).toBeLessThanOrEqual(1)
    })

    test('keeps its window when the chart is measured at zero width', () => {
        // Collapsing the timeline hides the chart, and the observer then
        // reports no width. The transform conversions have no scale to work
        // through at that width and fall back to the global window;
        // committing that fallback would discard the zoom the user had.
        const observed: ((entries: { contentRect: { width: number } }[]) => void)[] = []
        ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
            constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
                observed.push(callback)
            }
            observe() {}
            unobserve() {}
            disconnect() {}
        }

        render(WEEK)
        reported.length = 0

        act(() => {
            observed.forEach((callback) => callback([{ contentRect: { width: 0 } }]))
        })

        expect(reported).toEqual([])
    })

    test('leaves d3 holding the window after a drag open across a rebuild', () => {
        // d3 writes the transform before it notifies, so a silenced drag
        // walks it somewhere the window never went.
        const view = document.defaultView!
        const mouse = (type: string, clientX: number) => {
            const event = new MouseEvent(type, {
                bubbles: true,
                clientX,
                clientY: 10,
            })
            Object.defineProperty(event, 'view', { value: view })
            return event
        }

        const wider: ViewWindow = {
            start: new Date('2019-01-01T00:00:00Z'),
            end: END,
        }

        render(WEEK)
        act(() => {
            chart().dispatchEvent(mouse('mousedown', 400))
        })

        render(WEEK, wider)
        act(() => {
            view.dispatchEvent(mouse('mousemove', 420))
            view.dispatchEvent(mouse('mouseup', 420))
        })

        // 800 is the width the view starts at, which the stub leaves alone.
        const held = transformToWindow(zoomTransform(chart()), wider, 800)
        expect(held.start.toISOString()).toBe(WEEK.start.toISOString())
        expect(held.end.toISOString()).toBe(WEEK.end.toISOString())
    })

    test('keeps the chart live when a drag is open across a rebuild', () => {
        // A replacement behaviour claims an open gesture by name and
        // dispatches through the detached listeners, so the chart goes inert.
        const view = document.defaultView!
        const mouse = (type: string, clientX: number) => {
            const event = new MouseEvent(type, {
                bubbles: true,
                clientX,
                clientY: 10,
            })
            Object.defineProperty(event, 'view', { value: view })
            return event
        }

        render(WEEK)
        act(() => {
            chart().dispatchEvent(mouse('mousedown', 400))
        })

        render(WEEK, { start: new Date('2019-01-01T00:00:00Z'), end: END })
        act(() => {
            chart().dispatchEvent(
                new WheelEvent('wheel', { bubbles: true, deltaY: -100, clientX: 400, clientY: 10 })
            )
        })

        expect(reported.length).toBeGreaterThan(0)
    })
})
