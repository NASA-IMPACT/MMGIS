import { describe, test, expect, vi } from 'vitest'
import { measureLegendBand, drawLegendBand } from '../renderLegendBand.ts'

const makeCtx = () => {
    const fillRectCalls = []
    const fillTextCalls = []
    const gradients = []
    const ctx = {
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: (...args) => fillRectCalls.push({ args }),
        // The font is recorded with each line of text because it is what says
        // how far below its baseline that line reaches.
        fillText: (...args) => fillTextCalls.push({ args, font: ctx.font }),
        measureText: (t) => ({ width: t.length * 6 }),
        createLinearGradient: (...args) => {
            const stops = []
            const gradient = {
                addColorStop: (offset, color) => stops.push({ offset, color }),
            }
            gradients.push({ args, stops, gradient })
            return gradient
        },
        save: vi.fn(),
        restore: vi.fn(),
    }
    return { ctx, fillRectCalls, fillTextCalls, gradients }
}

const fontPx = (font) => {
    const match = font.match(/(\d+)px/)
    return match ? Number(match[1]) : 0
}

// The first three rects are always the frame; everything after is content.
const frameOf = (fillRectCalls) => fillRectCalls[2]
const contentRects = (fillRectCalls) => fillRectCalls.slice(3)
const textBottom = ({ args: [, , y], font }) => y + fontPx(font)

const model = (rows, overrides = {}) => ({
    missionName: null,
    headerLines: [],
    rows,
    ...overrides,
})

const gradientRow = (overrides = {}) => ({
    kind: 'gradient',
    title: 'Displacement',
    dateLine: null,
    colors: ['#000', '#fff'],
    min: 0,
    max: 10,
    unit: null,
    ...overrides,
})

const categoricalRow = (stops, overrides = {}) => ({
    kind: 'categorical',
    title: 'Classes',
    dateLine: null,
    stops,
    ...overrides,
})

const plainRow = (overrides = {}) => ({
    kind: 'plain',
    title: 'Basemap',
    dateLine: null,
    ...overrides,
})

const manyStops = Array.from({ length: 20 }, (_, i) => ({
    color: '#abc',
    label: `Category number ${i}`,
}))

describe('measureLegendBand', () => {
    // Rows share a line when the band is wide enough for columns, and stack
    // when it is not.
    test('rows sit side by side once the band is wide enough for columns', () => {
        const { ctx } = makeCtx()
        const one = model([gradientRow()])
        const three = model([
            gradientRow(),
            gradientRow({ title: 'Second' }),
            gradientRow({ title: 'Third' }),
        ])
        expect(measureLegendBand(ctx, three, 1200, 1)).toBe(
            measureLegendBand(ctx, one, 1200, 1),
        )
        expect(measureLegendBand(ctx, three, 400, 1)).toBeGreaterThan(
            measureLegendBand(ctx, one, 400, 1),
        )
    })
})

describe('drawLegendBand', () => {
    // A one-color ramp has no interpolation to build: addColorStop's offset
    // would be i / (length - 1) = NaN, which a real canvas rejects outright,
    // taking the whole export down with it. Nor is a missing or blank color a
    // reason to throw — the neutral ramp stands in.
    test.each([
        ['a single color', ['#ff0000'], 0],
        ['no colors at all', null, 1],
        ['an empty color list', [], 1],
        ['a blank stop among real ones', ['#000', '', '#fff'], 1],
    ])('draws a ramp built from %s', (_name, colors, expectedGradients) => {
        const { ctx, gradients } = makeCtx()
        const m = model([gradientRow({ colors })])
        expect(() => drawLegendBand(ctx, m, 400, 0, 200, 1)).not.toThrow()
        expect(gradients).toHaveLength(expectedGradients)
    })

    test('clips text that will not fit rather than overflowing the band', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const m = model(
            [
                categoricalRow([{ color: '#abc', label: 'C'.repeat(200) }], {
                    title: 'B'.repeat(200),
                }),
            ],
            { missionName: 'A'.repeat(200) },
        )
        drawLegendBand(ctx, m, 300, 0, measureLegendBand(ctx, m, 300, 1), 1)
        const drawn = fillTextCalls.map(({ args: [text] }) => text)
        expect(drawn).toHaveLength(3)
        for (const text of drawn) {
            expect(text.length).toBeLessThan(200)
            expect(text.endsWith('…')).toBe(true)
        }
    })

})

// The measure pass and the draw pass are two readings of the same layout, and
// a disagreement between them crops the band or leaves a white gap under it —
// both of which produce a plausible-looking export file.
describe('what is drawn fits the band that was measured', () => {
    const assertFits = (m, width, scale) => {
        const { ctx, fillRectCalls, fillTextCalls } = makeCtx()
        const bandHeight = measureLegendBand(ctx, m, width, scale)
        const yTop = 50
        drawLegendBand(ctx, m, width, yTop, bandHeight, scale)

        // Nothing painted extends past the height the measure pass computed.
        for (const { args } of fillRectCalls) {
            const [, y, , h] = args
            expect(y + h).toBeLessThanOrEqual(yTop + bandHeight)
        }
        for (const call of fillTextCalls) {
            expect(textBottom(call)).toBeLessThanOrEqual(yTop + bandHeight)
        }

        // And no slack: the deepest thing drawn sits the same padding above
        // the panel's bottom edge as the first thing drawn sits below its top.
        const [, py, , ph] = frameOf(fillRectCalls).args
        const contentTop = Math.min(
            ...contentRects(fillRectCalls).map(({ args: [, y] }) => y),
            ...fillTextCalls.map(({ args: [, , y] }) => y),
        )
        const contentBottom = Math.max(
            ...contentRects(fillRectCalls).map(({ args: [, y, , h] }) => y + h),
            ...fillTextCalls.map(textBottom),
        )
        expect(contentTop - py).toBeGreaterThan(0)
        expect(py + ph - contentBottom).toBe(contentTop - py)
    }

    test.each([1, 2])('wrapping categorical labels (scale %i)', (scale) => {
        assertFits(model([categoricalRow(manyStops)]), 300, scale)
    })

    test.each([1, 2])(
        'mixed rows where only some carry a date line (scale %i)',
        (scale) => {
            assertFits(
                model(
                    [
                        gradientRow({ dateLine: '2015-03-13 → 2026-08-25' }),
                        plainRow({ dateLine: 'Collected from 2016-05-01' }),
                        gradientRow({ title: 'Fixed scene' }),
                        categoricalRow(manyStops, { dateLine: 'Collected 2024' }),
                        categoricalRow(manyStops.slice(0, 3)),
                    ],
                    {
                        missionName: 'M20',
                        headerLines: ['Time cursor 2024-02-01', 'Exported now'],
                    },
                ),
                300,
                scale,
            )
        },
    )

    test.each([1, 2])(
        'columns where the tallest cell sets each line (scale %i)',
        (scale) => {
            assertFits(
                model(
                    [
                        plainRow(),
                        categoricalRow(manyStops, {
                            dateLine: 'Collected 2024',
                        }),
                        gradientRow(),
                        gradientRow({
                            title: 'Fourth',
                            dateLine: 'Collected 2024',
                        }),
                        plainRow({ title: 'Fifth' }),
                    ],
                    { missionName: 'M20', headerLines: ['Exported now'] },
                ),
                1200,
                scale,
            )
        },
    )
})
