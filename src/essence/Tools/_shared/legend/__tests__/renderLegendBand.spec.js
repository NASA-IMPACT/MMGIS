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
    headerFacts: [],
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
    // never scaled to; a bound it did declare carries the unit, set lighter
    // than the number it qualifies.
    test('labels only the bounds the layer declared', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const m = model([gradientRow({ min: null, max: 0.5, unit: 'm' })])
        drawLegendBand(ctx, m, 400, 0, measureLegendBand(ctx, m, 400, 1), 1)
        const [, value, unit, ...rest] = fillTextCalls
        expect(fillTextCalls.map(({ args: [text] }) => text)).toEqual([
            'Displacement',
            '0.5',
            ' m',
        ])
        expect(rest).toEqual([])
        expect(value.font.startsWith('400 ')).toBe(true)
        expect(unit.font.startsWith('300 ')).toBe(true)
    })

    // A white swatch would vanish into the white band, so a pale color gets
    // a hairline edge; a color that stands out on its own is drawn bare.
    test('edges only the swatches too pale to show against the band', () => {
        const edgesFor = (color) => {
            const { ctx } = makeCtx()
            const fills = []
            const record = ctx.fillRect
            ctx.fillRect = (...args) => {
                fills.push(ctx.fillStyle)
                record(...args)
            }
            const m = model([categoricalRow([{ color, label: 'A' }])])
            drawLegendBand(ctx, m, 400, 0, measureLegendBand(ctx, m, 400, 1), 1)
            // The band's own surface is the first fill; the rest are the
            // swatch.
            return fills.slice(1)
        }
        expect(edgesFor('#ffffff')).toEqual(['#dfe1e2', '#ffffff'])
        expect(edgesFor('#1c5f2c')).toEqual(['#1c5f2c'])
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

    // Each header fact is a small label over its value, and the next fact
    // is set further apart than a label is from its own value, so the two
    // facts don't read as one run of four lines.
    test('stacks each header fact as a smaller label over its value', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const m = model([plainRow()], {
            missionName: 'M20',
            headerFacts: [
                { label: 'Time cursor', value: '2024-02-01' },
                { label: 'Exported', value: 'now' },
            ],
        })
        drawLegendBand(ctx, m, 400, 0, measureLegendBand(ctx, m, 400, 1), 1)
        const byText = (t) => fillTextCalls.find(({ args }) => args[0] === t)
        const cursorLabel = byText('Time cursor')
        const cursorValue = byText('2024-02-01')
        const exportedLabel = byText('Exported')
        expect(fontPx(cursorLabel.font)).toBeLessThan(fontPx(cursorValue.font))
        expect(cursorValue.args[1]).toBe(cursorLabel.args[1])
        const labelToValue = cursorValue.args[2] - textBottom(cursorLabel)
        const factToFact = exportedLabel.args[2] - textBottom(cursorValue)
        expect(labelToValue).toBeGreaterThan(0)
        expect(factToFact).toBeGreaterThan(labelToValue)
    })

    // Beside the rows, the header column is as wide as its longest line, so
    // the rows start right after a short title; a longer one moves them right,
    // and past 25% of the band the title wraps instead. The gap either side
    // of the hairline is widest beside a short header, where there is room to
    // spare, and down to its 48px floor once the header fills its 25%.
    test('sizes the header column to its text, up to 25% of the band', () => {
        const rowsLeftFor = (missionName) => {
            const { ctx, fillTextCalls } = makeCtx()
            const m = model([plainRow({ title: 'Row' })], { missionName })
            drawLegendBand(ctx, m, 1200, 0, measureLegendBand(ctx, m, 1200, 1), 1)
            return fillTextCalls.find(({ args }) => args[0] === 'Row').args[1]
        }
        const cap = Math.floor((1200 - 64) * 0.25)
        const short = rowsLeftFor('M20')
        // 45 characters at the fake 6px each: short of the cap.
        const between = rowsLeftFor('Greenhouse Gas Emissions Monitoring for North')
        const huge = rowsLeftFor('Greenhouse Gas Emissions '.repeat(8))
        // The band's padding, the column, and the hairline with the gap
        // either side of it. 'M20' is 18px at the fake 6px per character.
        expect(short).toBe(32 + 18 + 2 * 96 + 1)
        expect(between).toBeGreaterThan(short)
        expect(huge).toBeGreaterThan(between)
        expect(huge).toBe(32 + cap + 2 * 48 + 1)
    })

    test('wraps a long header line onto at most four lines', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const title = 'Greenhouse Gas Emissions '.repeat(12).trim()
        const m = model([plainRow({ title: 'Row' })], { missionName: title })
        drawLegendBand(ctx, m, 1200, 0, measureLegendBand(ctx, m, 1200, 1), 1)
        const titleLines = fillTextCalls.filter(({ args }) => args[0] !== 'Row')
        expect(titleLines).toHaveLength(4)
        expect(titleLines[3].args[0].endsWith('…')).toBe(true)
        const cap = Math.floor((1200 - 64) * 0.25)
        for (const { args } of titleLines) {
            expect(ctx.measureText(args[0]).width).toBeLessThanOrEqual(cap)
            expect(args[1]).toBe(titleLines[0].args[1])
        }
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
            headerFacts: [
                { label: 'Time cursor', value: '2024-02-01' },
                { label: 'Exported', value: 'now' },
            ],
        },
    )

    test('rows stacked in one narrow column', () => {
        assertFits(mixedRows, 300)
    })

    test('rows flowed into columns, the tallest cell setting each line', () => {
        assertFits(mixedRows, 1200)
    })

    test('a header wrapped onto several lines', () => {
        const wrapped = {
            ...mixedRows,
            missionName: 'Greenhouse Gas Emissions '.repeat(6).trim(),
        }
        assertFits(wrapped, 1200)
        assertFits(wrapped, 300)
    })
})
