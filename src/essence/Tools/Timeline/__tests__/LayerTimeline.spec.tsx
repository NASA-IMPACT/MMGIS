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

    const render = (layer: LayerTimeData) => {
        act(() => {
            root.render(
                <svg>
                    <LayerTimeline
                        layer={layer}
                        xScale={xScale}
                        y={0}
                        height={20}
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
})
