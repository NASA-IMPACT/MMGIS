import { describe, test, expect, vi } from 'vitest'
import {
    boundLabel,
    measureLegendBand,
    drawLegendBand,
} from '../renderLegendBand.ts'

const makeCtx = () => {
    const fillRectCalls = []
    const fillTextCalls = []
    const ctx = {
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: (...args) => fillRectCalls.push({ args }),
        // The font is recorded with each line of text because it is what says
        // how far below its baseline that line reaches.
        fillText: (...args) => fillTextCalls.push({ args, font: ctx.font }),
        measureText: (t) => ({ width: t.length * 6 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        save: vi.fn(),
        restore: vi.fn(),
    }
    return { ctx, fillRectCalls, fillTextCalls }
}

const fontPx = (font) => {
    const match = font.match(/(\d+)px/)
    return match ? Number(match[1]) : 0
}

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
    colors: ['#000', '#fff'],
    min: 0,
    max: 10,
    unit: null,
    ...overrides,
})

const categoricalRow = (stops, overrides = {}) => ({
    kind: 'categorical',
    title: 'Classes',
    stops,
    ...overrides,
})

const plainRow = (overrides = {}) => ({
    kind: 'plain',
    title: 'Basemap',
    ...overrides,
})

const manyStops = Array.from({ length: 20 }, (_, i) => ({
    color: '#abc',
    label: `Category number ${i}`,
}))

// The same rules the panel's gradient bar labels its bounds by
// (GradientGraphic's formatLegendValue), so a layer reads the same in the app
// and on the export.
test('labels a bound the way the panel does', () => {
    expect(boundLabel(0.00095, null)).toBe('0.001')
    expect(boundLabel(0.0009, null)).toBe('9.00e-4')
    expect(boundLabel(9999, null)).toBe('1.00e+4')
    expect(boundLabel(0, null)).toBe('0')
    expect(boundLabel(1.5, 'm')).toBe('1.5 m')
    expect(boundLabel(null, 'm')).toBe('')
})

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
    // A degenerate color list is a legend core could not fully resolve, not a
    // reason to lose the export: one color has no interpolation to build (an
    // offset of i / (length - 1) = NaN, which a real canvas rejects outright),
    // and a missing, empty or blank color has nothing to interpolate from.
    test('draws a ramp from any color list, however degenerate', () => {
        for (const colors of [['#ff0000'], null, [], ['#000', '', '#fff']]) {
            const { ctx } = makeCtx()
            const m = model([gradientRow({ colors })])
            expect(() => drawLegendBand(ctx, m, 400, 0, 200, 1)).not.toThrow()
        }
    })

    // A bound the layer never declared is blank, never a 0 the layer was
    // never scaled to; a bound it did declare carries the unit.
    test('labels only the bounds the layer declared', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const m = model([gradientRow({ min: null, max: 0.5, unit: 'm' })])
        drawLegendBand(ctx, m, 400, 0, measureLegendBand(ctx, m, 400, 1), 1)
        expect(fillTextCalls.map(({ args: [text] }) => text)).toEqual([
            'Displacement',
            '',
            '0.5 m',
        ])
    })

    // The date line sits under the name it belongs to, in the smaller
    // metadata type rather than the row title's.
    test("prints a row's date line under its name", () => {
        const { ctx, fillTextCalls } = makeCtx()
        const m = model([plainRow({ dateLine: 'Collected 2016-05' })])
        drawLegendBand(ctx, m, 400, 0, measureLegendBand(ctx, m, 400, 1), 1)
        const [title, date] = fillTextCalls
        expect(date.args[0]).toBe('Collected 2016-05')
        expect(date.args[1]).toBe(title.args[1])
        expect(date.args[2]).toBeGreaterThan(title.args[2])
        expect(fontPx(date.font)).toBeLessThan(fontPx(title.font))
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
    const SCALE = 2

    const assertFits = (m, width) => {
        const { ctx, fillRectCalls, fillTextCalls } = makeCtx()
        const bandHeight = measureLegendBand(ctx, m, width, SCALE)
        const yTop = 50
        drawLegendBand(ctx, m, width, yTop, bandHeight, SCALE)

        // Nothing painted extends past the height the measure pass computed.
        for (const { args } of fillRectCalls) {
            const [, y, , h] = args
            expect(y + h).toBeLessThanOrEqual(yTop + bandHeight)
        }
        for (const call of fillTextCalls) {
            expect(textBottom(call)).toBeLessThanOrEqual(yTop + bandHeight)
        }

        // And no slack: the deepest thing drawn sits as far above the band's
        // bottom edge as the first thing drawn sits below its top. The band's
        // own frame is drawn as rects that span it, so content is what does
        // not.
        const content = fillRectCalls.filter(
            ({ args: [, , , h] }) => h < bandHeight / 2,
        )
        const contentTop = Math.min(
            ...content.map(({ args: [, y] }) => y),
            ...fillTextCalls.map(({ args: [, , y] }) => y),
        )
        const contentBottom = Math.max(
            ...content.map(({ args: [, y, , h] }) => y + h),
            ...fillTextCalls.map(textBottom),
        )
        expect(contentTop - yTop).toBeGreaterThan(0)
        expect(yTop + bandHeight - contentBottom).toBe(contentTop - yTop)
    }

    const mixedRows = model(
        [
            gradientRow({ dateLine: 'Collected 2024-01-08 → 2024-02-01' }),
            plainRow({ dateLine: 'Collected from 2016-05-01' }),
            categoricalRow(manyStops),
            categoricalRow(manyStops.slice(0, 3)),
        ],
        {
            missionName: 'M20',
            headerLines: ['Time cursor 2024-02-01', 'Exported now'],
        },
    )

    test('rows stacked in one narrow column', () => {
        assertFits(mixedRows, 300)
    })

    test('rows flowed into columns, the tallest cell setting each line', () => {
        assertFits(mixedRows, 1200)
    })
})
