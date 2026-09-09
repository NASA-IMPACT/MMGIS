import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { scaleTime } from 'd3-scale'

import { LayerTimeline } from '../lib/geo/LayerTimeline/LayerTimeline'
import type { LayerTimeData } from '../lib/types'

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
     * Zoomed out to a multi-year view a single day is narrower than a pixel.
     * The boxes are floored to a visible width rather than scaled away, so a
     * sparse layer still reads as having data on those days.
     */
    test('keeps a sub-pixel day visible', () => {
        const [rect] = render(
            layerWith([
                {
                    start: new Date('2020-03-04T00:00:00Z'),
                    end: new Date('2020-03-04T23:59:59Z'),
                    label: '2020-03-04',
                },
            ])
        )

        expect(Number(rect.getAttribute('width'))).toBeGreaterThanOrEqual(2)
    })

    /**
     * The sidebar row is sized to fit the transport buttons it carries, which
     * is taller than the bar itself wants to be — a bar that scaled with its
     * row would make every chart look heavier for no reason. The bar's
     * thickness is fixed, and it stays centred in whatever row it's given.
     */
    test('keeps the same bar thickness centred whether the row is 15px or 20px', () => {
        const range = { start: new Date('2020-03-04T00:00:00Z'), end: new Date('2020-07-19T00:00:00Z') }

        // React reuses the same host <rect> across renders on one root, so
        // each row height must be read out before the next render overwrites it.
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
