import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * How the timeline's sidebar carries a layer's navigation controls: which rows
 * get them, and where a press is delivered.
 *
 * The process timezone is pinned behind UTC so that a row resolving its
 * target in local time would surface here as a wrong instant, rather than
 * passing on a UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import { TimelineView } from '../lib/geo/TimelineView/TimelineView'
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import type { LayerTimeData, TimeMode } from '../lib/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver; the view constructs one to follow the width of
// the chart area. The stub never reports a size, leaving the view on the
// starting width it lays the SVG out with.
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
                    layers={layers}
                    onCurrentTimeChange={(date) => committed.push(date)}
                    onLayerNavigate={(date) => navigated.push(date)}
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
        // Dispatched rather than clicked so that a control disabled in name
        // only — through aria-disabled, say — would still deliver the event
        // and be caught.
        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
    }

    test('gives a layer that carries a navigation model its four controls', () => {
        render([layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02'))])

        expect(
            rowButtons(0).map((button) => button.getAttribute('aria-label')),
        ).toEqual([
            'MODIS Daily: first date',
            'MODIS Daily: previous date',
            'MODIS Daily: next date',
            'MODIS Daily: last date',
        ])
    })

    test('leaves a layer with nothing to navigate without controls', () => {
        // A layer the resolver found no instant for carries no model, and so
        // opts its row out without the row asking what kind of layer it is.
        render([
            layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02')),
            layer('Basemap'),
        ])

        expect(rowButtons(0)).toHaveLength(4)
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
        // The step a periodic layer takes is the timeline's own, so the row
        // only lands a month on from May with the view's mode reaching it.
        render(
            [layer('Sea Surface Temperature', {
                kind: 'periodic',
                start: START,
                end: END,
            })],
            'MONTH',
        )

        press(0, 'Sea Surface Temperature: next date')

        expect(navigated.map((date) => date.toISOString())).toEqual([
            '2020-06-01T00:00:00.000Z',
        ])
    })

    test('keeps a layer jump off the scrubber\'s commit path', () => {
        // The two paths treat the timeline's window differently, so a jump
        // must not arrive as though the scrubber had been moved.
        render([layer('MODIS Daily', sparseNav('2020-01-02', '2020-11-02'))])

        press(0, 'MODIS Daily: first date')

        expect(navigated).toHaveLength(1)
        expect(committed).toEqual([])
    })

    test('keeps each sidebar row the height of the chart row beside it', () => {
        // The two columns share one pitch; a row drifting from its bar is how
        // the sidebar stops naming the layer it sits against.
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
