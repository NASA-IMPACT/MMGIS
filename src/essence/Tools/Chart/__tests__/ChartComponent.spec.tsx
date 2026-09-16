import React, { act } from 'react'
import { describe, test, expect, vi } from 'vitest'
import { ChartComponent } from '../ChartComponent'

// The histogram is not under test, and Chart.js needs a canvas and a
// ResizeObserver that jsdom does not provide.
vi.mock('chart.js/auto', () => ({ default: class { destroy() {} } }))
import { mount } from '../../_shared/__tests__/reactHarness'
import type { AnalysisData, AssetStats } from '../chartHelpers'

const stats = (mean: number): AssetStats => ({
    min: 0,
    max: 10,
    mean,
    count: 4,
    sum: mean * 4,
    std: 1,
    median: mean,
    majority: mean,
    minority: mean,
    unique: 4,
    histogram: [[1, 3], [0, 5, 10]],
    valid_percent: 100,
    masked_pixels: 0,
    valid_pixels: 4,
    percentile_2: 0,
    percentile_98: 10,
})

const result = (mean: number) => ({
    type: 'Feature' as const,
    geometry: null,
    properties: { statistics: { data: stats(mean) } },
})

const TWO_LAYERS: AnalysisData = { co2: result(1), no2: result(2) }

const titles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.chart-tool__card-title')).map((el) => el.textContent)

const pick = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
    })
}

describe('ChartComponent layer picker', () => {
    test('shows only the first layer with a picker listing every layer', async () => {
        const { container, unmount } = await mount(<ChartComponent analysisData={TWO_LAYERS} />)

        expect(titles(container)).toEqual(['co2'])
        const options = Array.from(container.querySelectorAll('option')).map((o) => o.textContent)
        expect(options).toEqual(['co2', 'no2'])
        await unmount()
    })

    test('picking a layer swaps the card shown', async () => {
        const { container, unmount } = await mount(<ChartComponent analysisData={TWO_LAYERS} />)

        await pick(container.querySelector('select')!, 'no2__data')
        expect(titles(container)).toEqual(['no2'])
        await unmount()
    })

    test('a single layer shows its card with no picker', async () => {
        const { container, unmount } = await mount(
            <ChartComponent analysisData={{ co2: result(1) }} />,
        )

        expect(titles(container)).toEqual(['co2'])
        expect(container.querySelector('select')).toBeNull()
        await unmount()
    })

    test('a pick that new results no longer carry falls back to the first card', async () => {
        const { container, rerender, unmount } = await mount(
            <ChartComponent analysisData={TWO_LAYERS} />,
        )
        await pick(container.querySelector('select')!, 'no2__data')

        await rerender(<ChartComponent analysisData={{ so2: result(3), ch4: result(4) }} />)
        expect(titles(container)).toEqual(['so2'])
        await unmount()
    })
})
