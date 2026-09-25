import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { scaleTime } from 'd3-scale'

import { LayerTimeline } from '../lib/geo/LayerTimeline/LayerTimeline'
import type { LayerTimeData } from '../lib/types'
import { resolveLayerNavigation } from '../lib/utils/layerNavigation'
import { resolveLayerTimeRanges } from '../lib/utils/timeUtils'
import type { LayerTimeConfig } from '../lib/utils/timeUtils'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const YEAR_START = new Date('2020-01-01T00:00:00Z')
const YEAR_END = new Date('2021-01-01T00:00:00Z')

// A year across 800px: a single day is roughly two thirds of a pixel wide.
const xScale = scaleTime().domain([YEAR_START, YEAR_END]).range([0, 800])

const layerWith = (timeRanges: LayerTimeData['timeRanges']): LayerTimeData => ({
    name: 'sparse',
    displayName: 'Sparse Layer',
    color: '#c91b6e',
    timeRanges,
})

describe('LayerTimeline', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (layer: LayerTimeData, y = 0, height = 20) => {
        act(() => {
            root.render(
                <svg>
                    <LayerTimeline
                        layer={layer}
                        xScale={xScale}
                        bounds={{ start: YEAR_START, end: YEAR_END }}
                        y={y}
                        height={height}
                    />
                </svg>
            )
        })
        return Array.from(container.querySelectorAll('rect'))
    }

    test('draws a box for every span the layer holds data over', () => {
        const rects = render(
            layerWith([
                {
                    start: new Date('2020-03-04T00:00:00Z'),
                    end: new Date('2020-03-04T23:59:59Z'),
                    label: '2020-03-04',
                },
                {
                    start: new Date('2020-07-19T00:00:00Z'),
                    end: new Date('2020-07-19T23:59:59Z'),
                    label: '2020-07-19',
                },
            ])
        )

        expect(rects).toHaveLength(2)
    })

    test('names a labelled span by its label rather than two instants', () => {
        const [rect] = render(
            layerWith([
                {
                    start: new Date('2020-03-04T00:00:00Z'),
                    end: new Date('2020-03-04T23:59:59Z'),
                    label: '2020-03-04',
                },
            ])
        )

        expect(rect.querySelector('title')?.textContent).toBe(
            'Sparse Layer\n2020-03-04'
        )
    })

    test('spells out an unlabelled span from its start to its end', () => {
        const [rect] = render(
            layerWith([{ start: YEAR_START, end: YEAR_END }])
        )

        expect(rect.querySelector('title')?.textContent).toBe(
            `Sparse Layer\n${YEAR_START.toISOString()} to ${YEAR_END.toISOString()}`
        )
    })

    /**
     * Zoomed out, a single day is only a pixel or two wide. Boxes are floored
     * to a visible width, so a sparse layer still reads as having data on
     * those days.
     */
    test('keeps a narrow day visible', () => {
        const [rect] = render(
            layerWith([
                {
                    start: new Date('2020-03-04T00:00:00Z'),
                    end: new Date('2020-03-04T23:59:59Z'),
                    label: '2020-03-04',
                },
            ])
        )

        expect(Number(rect.getAttribute('width'))).toBe(6)
    })

    /**
     * A floored box grows both ways from its span, so it stays over its own
     * time: an instant sits under the scrubber when the scrubber is on it.
     */
    test('centres a floored box on its span', () => {
        const instant = new Date('2020-07-01T12:00:00Z')
        const [rect] = render(
            layerWith([{ start: instant, end: instant, label: 'instant' }])
        )

        const x = Number(rect.getAttribute('x'))
        const width = Number(rect.getAttribute('width'))
        expect(x + width / 2).toBeCloseTo(xScale(instant))
    })

    /**
     * A row is sized to fit the transport buttons it carries, which is taller
     * than the bar wants to be. The bar's thickness is fixed rather than
     * scaled with the row, and it stays centred in whatever row it's given.
     */
    test('keeps the same bar thickness centred whether the row is 15px or 20px', () => {
        const range = { start: new Date('2020-03-04T00:00:00Z'), end: new Date('2020-07-19T00:00:00Z') }

        // React reuses the same host <rect> across renders on one root, so
        // each height is read out before the next render overwrites it.
        const [shortRowRect] = render(layerWith([range]), 0, 15)
        const shortHeight = Number(shortRowRect.getAttribute('height'))
        const shortY = Number(shortRowRect.getAttribute('y'))

        const [tallRowRect] = render(layerWith([range]), 0, 20)
        const tallHeight = Number(tallRowRect.getAttribute('height'))
        const tallY = Number(tallRowRect.getAttribute('y'))

        expect(shortHeight).toBe(9)
        expect(tallHeight).toBe(9)

        // Centred: the gap above the bar equals the gap below it.
        expect(shortY).toBeCloseTo((15 - shortHeight) / 2)
        expect(tallY).toBeCloseTo((20 - tallHeight) / 2)
    })

    test('centres the bar within a row offset from the SVG origin', () => {
        const range = { start: new Date('2020-03-04T00:00:00Z'), end: new Date('2020-07-19T00:00:00Z') }

        const [rect] = render(layerWith([range]), 100, 20)

        const height = Number(rect.getAttribute('height'))
        expect(height).toBe(9)
        expect(Number(rect.getAttribute('y'))).toBeCloseTo(100 + (20 - height) / 2)
    })
})

describe('LayerTimeline divisions and edges', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    /** The global window every layer here falls back to. */
    const GLOBAL = {
        start: new Date('2020-01-01T00:00:00Z'),
        end: new Date('2021-01-01T00:00:00Z'),
    }

    // The chart keeps an 18px margin either side of an 800px chart, as the
    // view draws it.
    const MARGIN = 18
    const scaleOver = (start: string, end: string) =>
        scaleTime()
            .domain([new Date(start), new Date(end)])
            .range([MARGIN, 800 - MARGIN])

    /** A layer built the way the adapter builds one from its time config. */
    const periodic = (time: LayerTimeConfig): LayerTimeData => ({
        name: 'periodic',
        displayName: 'Periodic Layer',
        color: '#c91b6e',
        timeRanges: resolveLayerTimeRanges(time, GLOBAL.start, GLOBAL.end),
        navigation: resolveLayerNavigation(time, GLOBAL.start, GLOBAL.end),
    })

    const render = (
        layer: LayerTimeData,
        xScale: ReturnType<typeof scaleOver>,
        bounds = GLOBAL
    ) => {
        act(() => {
            root.render(
                <svg>
                    <LayerTimeline
                        layer={layer}
                        xScale={xScale}
                        bounds={bounds}
                        y={0}
                        height={22}
                    />
                </svg>
            )
        })
    }

    /**
     * The day of every division pinched, read back through the scale. Each
     * division is pinched from above and below, and each bite starts at the
     * division itself.
     */
    const divisions = (xScale: ReturnType<typeof scaleOver>) => {
        const d =
            container
                .querySelector('.layer-time-divisions')
                ?.getAttribute('d') ?? ''
        const xs = Array.from(d.matchAll(/M([-\d.e]+),/g)).map((m) => m[1])
        return [...new Set(xs)].map((x) =>
            xScale.invert(Number(x)).toISOString().slice(0, 10)
        )
    }

    const bars = () => Array.from(container.querySelectorAll('rect'))

    test('divides a daily layer at every day', () => {
        const xScale = scaleOver('2020-03-01T00:00:00Z', '2020-03-15T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-03-03T00:00:00Z',
                dataEndTime: '2020-03-08T00:00:00Z',
                interval: 'P1D',
            }),
            xScale
        )

        // Strictly inside the bar: its own ends are not divisions.
        expect(divisions(xScale)).toEqual([
            '2020-03-04',
            '2020-03-05',
            '2020-03-06',
            '2020-03-07',
        ])
    })

    test('divides a weekly layer every seven days from its own start', () => {
        const xScale = scaleOver('2020-03-01T00:00:00Z', '2020-05-01T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-03-04T00:00:00Z',
                dataEndTime: '2020-04-08T00:00:00Z',
                interval: 'P7D',
            }),
            xScale
        )

        expect(divisions(xScale)).toEqual([
            '2020-03-11',
            '2020-03-18',
            '2020-03-25',
            '2020-04-01',
        ])
    })

    test('divides a monthly layer at each calendar month', () => {
        const xScale = scaleOver('2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-01-01T00:00:00Z',
                dataEndTime: '2020-06-01T00:00:00Z',
                interval: 'P1M',
            }),
            xScale
        )

        expect(divisions(xScale)).toEqual([
            '2020-02-01',
            '2020-03-01',
            '2020-04-01',
            '2020-05-01',
        ])
    })

    test('draws a long daily layer solid when zoomed out, and divided zoomed in', () => {
        const layer = periodic({
            enabled: true,
            dataStartTime: '2000-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
            interval: 'P1D',
        })
        const bounds = {
            start: new Date('2000-01-01T00:00:00Z'),
            end: new Date('2021-01-01T00:00:00Z'),
        }

        const out = scaleOver('2000-01-01T00:00:00Z', '2021-01-01T00:00:00Z')
        render(layer, out, bounds)
        expect(container.querySelector('.layer-time-divisions')).toBeNull()
        expect(bars()).toHaveLength(1)

        const zoomed = scaleOver('2010-06-01T00:00:00Z', '2010-06-11T00:00:00Z')
        render(layer, zoomed, bounds)
        // Only the days on the chart are drawn: the ten in view, and the one
        // either side that each margin shows.
        expect(divisions(zoomed)).toEqual([
            '2010-05-31',
            '2010-06-01',
            '2010-06-02',
            '2010-06-03',
            '2010-06-04',
            '2010-06-05',
            '2010-06-06',
            '2010-06-07',
            '2010-06-08',
            '2010-06-09',
            '2010-06-10',
            '2010-06-11',
        ])
    })

    test('draws a layer whose steps pass what a Date can hold, and returns', () => {
        const xScale = scaleOver('2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-01-01T00:00:00Z',
                dataEndTime: '2020-06-01T00:00:00Z',
                interval: 'P300000Y',
            }),
            xScale
        )

        expect(bars()).toHaveLength(1)
        expect(container.querySelector('.layer-time-divisions')).toBeNull()
    })

    test('draws a layer with no interval as one solid bar', () => {
        const xScale = scaleOver('2020-03-01T00:00:00Z', '2020-03-15T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-03-03T00:00:00Z',
                dataEndTime: '2020-03-08T00:00:00Z',
            }),
            xScale
        )

        expect(container.querySelector('.layer-time-divisions')).toBeNull()
        expect(bars()).toHaveLength(1)
    })

    test('stops bars and divisions at the global window, out of the margin', () => {
        // The view sits at the global window's end, so the right margin shows
        // time past it, over which this layer runs on.
        const xScale = scaleOver('2020-12-20T00:00:00Z', '2021-01-01T00:00:00Z')
        render(
            periodic({
                enabled: true,
                dataStartTime: '2020-12-01T00:00:00Z',
                dataEndTime: '2021-03-01T00:00:00Z',
                interval: 'P1D',
            }),
            xScale
        )

        const [bar] = bars()
        const right = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width'))
        expect(right).toBeCloseTo(800 - MARGIN, 6)
        const lastDivision = divisions(xScale).pop()
        expect(lastDivision).toBe('2020-12-31')
    })

    test('holds a floored box at the global window\'s edge', () => {
        const xScale = scaleOver('2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z')
        render(
            {
                name: 'sparse',
                displayName: 'Sparse Layer',
                color: '#c91b6e',
                timeRanges: [
                    {
                        start: new Date('2020-01-01T00:00:00Z'),
                        end: new Date('2020-01-01T23:59:59.999Z'),
                    },
                    {
                        start: new Date('2019-12-31T00:00:00Z'),
                        end: new Date('2019-12-31T23:59:59.999Z'),
                    },
                ],
            },
            xScale
        )

        // The first day is widened to the minimum but held off the margin;
        // the day before the window is not drawn at all.
        const drawn = bars()
        expect(drawn).toHaveLength(1)
        expect(Number(drawn[0].getAttribute('x'))).toBeCloseTo(MARGIN, 6)
    })
})
