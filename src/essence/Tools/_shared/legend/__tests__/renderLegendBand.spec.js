import { describe, test, expect, vi } from 'vitest'
import { measureLegendBand, drawLegendBand } from '../renderLegendBand.ts'

const makeCtx = () => {
    const fillRectCalls = []
    const fillTextCalls = []
    const ctx = {
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: (...args) => fillRectCalls.push(args),
        fillText: (...args) => fillTextCalls.push(args),
        measureText: (t) => ({ width: t.length * 6 }),
        createLinearGradient: () => ({ addColorStop: vi.fn() }),
        save: vi.fn(),
        restore: vi.fn(),
    }
    return { ctx, fillRectCalls, fillTextCalls }
}

const emptyModel = { missionName: null, timeLabel: null, rows: [] }

const gradientRow = (overrides = {}) => ({
    kind: 'gradient',
    title: 'Displacement',
    colors: ['#000', '#fff'],
    min: 0,
    max: 10,
    unit: null,
    ...overrides,
})

const categoricalRow = (stops) => ({
    kind: 'categorical',
    title: 'Classes',
    stops,
})

describe('measureLegendBand', () => {
    test('is 0 for a model with no rows', () => {
        const { ctx } = makeCtx()
        expect(measureLegendBand(ctx, emptyModel, 400, 1)).toBe(0)
    })

    test('grows as rows are added', () => {
        const { ctx } = makeCtx()
        const oneRow = { missionName: null, timeLabel: null, rows: [gradientRow()] }
        const twoRows = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow(), gradientRow({ title: 'Second' })],
        }
        const h1 = measureLegendBand(ctx, oneRow, 400, 1)
        const h2 = measureLegendBand(ctx, twoRows, 400, 1)
        expect(h1).toBeGreaterThan(0)
        expect(h2).toBeGreaterThan(h1)
    })

    test('categorical wrapping adds height when labels exceed the width', () => {
        const { ctx } = makeCtx()
        const manyStops = Array.from({ length: 20 }, (_, i) => ({
            color: '#abc',
            label: `Category number ${i}`,
        }))
        const narrow = {
            missionName: null,
            timeLabel: null,
            rows: [categoricalRow(manyStops)],
        }
        const wide = {
            missionName: null,
            timeLabel: null,
            rows: [categoricalRow(manyStops.slice(0, 2))],
        }
        const hNarrow = measureLegendBand(ctx, narrow, 300, 1)
        const hWide = measureLegendBand(ctx, wide, 300, 1)
        expect(hNarrow).toBeGreaterThan(hWide)
    })

    test('scale 2 doubles the measured height of the same model', () => {
        const { ctx } = makeCtx()
        const model = { missionName: 'Mission', timeLabel: null, rows: [gradientRow()] }
        const h1 = measureLegendBand(ctx, model, 400, 1)
        const h2 = measureLegendBand(ctx, model, 400, 2)
        expect(h2).toBe(h1 * 2)
    })
})

describe('drawLegendBand', () => {
    test('paints the white band exactly at yTop covering width x bandHeight', () => {
        const { ctx, fillRectCalls } = makeCtx()
        const model = { missionName: null, timeLabel: null, rows: [gradientRow()] }
        drawLegendBand(ctx, model, 400, 600, 100, 1)
        expect(fillRectCalls[0]).toEqual([0, 600, 400, 100])
    })

    test('draws the header once with mission and time joined', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: 'M20',
            timeLabel: '2024-01-01',
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const headerCalls = fillTextCalls.filter(([text]) =>
            text.includes('M20') && text.includes('2024-01-01'),
        )
        expect(headerCalls).toHaveLength(1)
        expect(headerCalls[0][0]).toBe('M20  ·  2024-01-01')
    })

    test('draws min/max bounds with units via formatLegendBound', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ min: 2, max: 8, unit: 'K' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const texts = fillTextCalls.map(([text]) => text)
        expect(texts).toContain('2 K')
        expect(texts).toContain('8 K')
    })

    test('null colors fall back to the neutral ramp without throwing', () => {
        const { ctx, fillRectCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ colors: null })],
        }
        expect(() => drawLegendBand(ctx, model, 400, 0, 200, 1)).not.toThrow()
        // The bar itself paints via the gradient fillStyle set from
        // createLinearGradient, so a fillRect beyond the band background is
        // proof the ramp was painted.
        expect(fillRectCalls.length).toBeGreaterThan(1)
    })
})
