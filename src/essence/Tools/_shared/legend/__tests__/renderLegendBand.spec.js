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
        // Recording `fillStyle` (and `font`, for fillText) at call time — not
        // just the draw args — is what lets a test tell a real color from an
        // all-white band: the call args alone never carry the paint color.
        fillRect: (...args) =>
            fillRectCalls.push({ args, fillStyle: ctx.fillStyle }),
        fillText: (...args) =>
            fillTextCalls.push({ args, fillStyle: ctx.fillStyle, font: ctx.font }),
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
        expect(fillRectCalls[0].args).toEqual([0, 600, 400, 100])
    })

    test('draws the header once with mission and time joined', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: 'M20',
            timeLabel: '2024-01-01',
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const headerCalls = fillTextCalls.filter(({ args: [text] }) =>
            text.includes('M20') && text.includes('2024-01-01'),
        )
        expect(headerCalls).toHaveLength(1)
        expect(headerCalls[0].args[0]).toBe('M20  ·  2024-01-01')
    })

    test('draws min/max bounds with units via formatLegendBound', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ min: 2, max: 8, unit: 'K' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const texts = fillTextCalls.map(({ args: [text] }) => text)
        expect(texts).toContain('2 K')
        expect(texts).toContain('8 K')
    })

    test('null colors fall back to the neutral ramp without throwing', () => {
        const { ctx, gradients } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ colors: null })],
        }
        expect(() => drawLegendBand(ctx, model, 400, 0, 200, 1)).not.toThrow()
        // Proof the ramp itself was painted, not just background/border
        // rects: the gradient built for the bar carries the neutral colors.
        expect(gradients).toHaveLength(1)
        expect(gradients[0].stops.map((s) => s.color)).toEqual([
            '#bdbdbd',
            '#757575',
        ])
    })

    test('a blank stop color in an otherwise-colored gradient still renders', () => {
        const { ctx, gradients } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ colors: ['#000', '', '#fff'] })],
        }
        expect(() => drawLegendBand(ctx, model, 400, 0, 200, 1)).not.toThrow()
        expect(gradients).toHaveLength(1)
        // The blank stop falls back to the neutral swatch; its neighbors keep
        // their authored colors.
        expect(gradients[0].stops.map((s) => s.color)).toEqual([
            '#000',
            '#bdbdbd',
            '#fff',
        ])
    })

    // A one-color ramp has no interpolation to build. addColorStop's offset
    // would be i / (length - 1) = NaN, which a real canvas rejects outright,
    // taking the whole band down with it.
    test('a single-color ramp fills a solid bar and builds no gradient', () => {
        const { ctx, fillRectCalls, gradients } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ colors: ['#ff0000'] })],
        }
        expect(() => drawLegendBand(ctx, model, 400, 0, 200, 1)).not.toThrow()
        expect(gradients).toHaveLength(0)
        const bar = fillRectCalls.find((c) => c.fillStyle === '#ff0000')
        expect(bar).toBeDefined()
        expect(bar.args[2]).toBeGreaterThan(0)
        expect(bar.args[3]).toBeGreaterThan(0)
    })

    test('an empty colors array falls back to the neutral ramp', () => {
        const { ctx, gradients } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ colors: [] })],
        }
        expect(() => drawLegendBand(ctx, model, 400, 0, 200, 1)).not.toThrow()
        expect(gradients).toHaveLength(1)
        expect(gradients[0].stops.map((s) => s.color)).toEqual([
            '#bdbdbd',
            '#757575',
        ])
    })

    // Blank bounds (an unrescaled raster) leave the labels empty rather than
    // printing an invented range.
    test('null bounds draw as empty labels', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ min: null, max: null, unit: 'm' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const texts = fillTextCalls.map(({ args: [text] }) => text)
        expect(texts).toEqual(['Displacement', '', ''])
    })
})

describe('drawLegendBand gradient bounds', () => {
    // Everything after the row title is a bound label: min first, then max.
    const boundCalls = (fillTextCalls) => fillTextCalls.slice(1)

    test('clips bounds so a long min and max cannot overlap', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [
                gradientRow({
                    min: '0.000000000000123 microseconds per parsec',
                    max: '9.999999999999876 microseconds per parsec',
                }),
            ],
        }
        drawLegendBand(ctx, model, 400, 0, 400, 1)
        const [minCall, maxCall] = boundCalls(fillTextCalls)
        expect(minCall.args[0].endsWith('\u2026')).toBe(true)
        expect(maxCall.args[0].endsWith('\u2026')).toBe(true)
        const minRight =
            minCall.args[1] + ctx.measureText(minCall.args[0]).width
        expect(minRight).toBeLessThanOrEqual(maxCall.args[1])
    })

    test('never starts the max bound left of the bar', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ min: 0, max: 'X'.repeat(300) })],
        }
        // A band narrower than the bar's nominal width, so the clamp is what
        // keeps the right-aligned label on canvas.
        drawLegendBand(ctx, model, 160, 0, 400, 1)
        const [, maxCall] = boundCalls(fillTextCalls)
        expect(maxCall.args[1]).toBeGreaterThanOrEqual(16)
    })

    test('leaves short bounds unclipped, at the bar edges', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ min: 2, max: 8, unit: 'K' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const [minCall, maxCall] = boundCalls(fillTextCalls)
        expect(minCall.args[0]).toBe('2 K')
        expect(maxCall.args[0]).toBe('8 K')
        // PAD (16) for the min; PAD + BAR_WIDTH (260) less the label's own
        // measured width for the right-aligned max.
        expect(minCall.args[1]).toBe(16)
        expect(maxCall.args[1]).toBe(16 + 260 - ctx.measureText('8 K').width)
    })
})

describe('drawLegendBand text clipping', () => {
    test('clips a long header to fit the band width, with an ellipsis', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: 'A'.repeat(200),
            timeLabel: null,
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 300, 0, 200, 1)
        const headerText = fillTextCalls[0].args[0]
        expect(headerText.length).toBeLessThan(200)
        expect(headerText.endsWith('…')).toBe(true)
    })

    test('clips a long row title to fit the band width, with an ellipsis', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [gradientRow({ title: 'B'.repeat(200) })],
        }
        drawLegendBand(ctx, model, 300, 0, 200, 1)
        const titleText = fillTextCalls[0].args[0]
        expect(titleText.length).toBeLessThan(200)
        expect(titleText.endsWith('…')).toBe(true)
    })

    test('clips an oversized category label rather than overflowing its line', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [categoricalRow([{ color: '#abc', label: 'C'.repeat(200) }])],
        }
        drawLegendBand(ctx, model, 300, 0, 200, 1)
        // 'Classes' (the row's own title) also starts with 'C' — look past it
        // for the long swatch label specifically.
        const labelCall = fillTextCalls.find(
            ({ args: [text] }) => text.startsWith('C') && text.length > 10,
        )
        expect(labelCall.args[0].length).toBeLessThan(200)
        expect(labelCall.args[0].endsWith('…')).toBe(true)
    })

    test('a short header/title/label is left untouched', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: 'M20',
            timeLabel: null,
            rows: [gradientRow({ title: 'Short' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        expect(fillTextCalls[0].args[0]).toBe('M20')
        expect(fillTextCalls[1].args[0]).toBe('Short')
    })
})

describe('drawn primitives stay within the measured band (regression)', () => {
    // Pins a property a reviewer probe confirmed already holds: nothing the
    // draw pass paints — a fillRect or a line of text — extends past the
    // band height the measure pass computed for the same model.
    const fontPx = (font) => {
        const match = font.match(/(\d+)px/)
        return match ? Number(match[1]) : 0
    }

    const assertWithinBand = (model, width, scale) => {
        const { ctx, fillRectCalls, fillTextCalls } = makeCtx()
        const bandHeight = measureLegendBand(ctx, model, width, scale)
        const yTop = 50
        const bottomLimit = yTop + bandHeight
        drawLegendBand(ctx, model, width, yTop, bandHeight, scale)

        for (const { args } of fillRectCalls) {
            const [, y, , h] = args
            expect(y + h).toBeLessThanOrEqual(bottomLimit)
        }
        for (const { args, font } of fillTextCalls) {
            const [, , y] = args
            expect(y + fontPx(font)).toBeLessThanOrEqual(bottomLimit)
        }
    }

    test('gradient-only model at scale 1 and 2', () => {
        const model = {
            missionName: 'M20',
            timeLabel: '2024-01-01',
            rows: [gradientRow(), gradientRow({ title: 'Second' })],
        }
        assertWithinBand(model, 400, 1)
        assertWithinBand(model, 400, 2)
    })

    test('wrapping categorical model at scale 1 and 2', () => {
        const manyStops = Array.from({ length: 20 }, (_, i) => ({
            color: '#abc',
            label: `Category number ${i}`,
        }))
        const model = {
            missionName: null,
            timeLabel: null,
            rows: [categoricalRow(manyStops)],
        }
        assertWithinBand(model, 300, 1)
        assertWithinBand(model, 300, 2)
    })

    test('mixed gradient and categorical model at scale 1 and 2', () => {
        const manyStops = Array.from({ length: 20 }, (_, i) => ({
            color: '#abc',
            label: `Category number ${i}`,
        }))
        const model = {
            missionName: 'M20',
            timeLabel: '2024-01-01',
            rows: [gradientRow(), categoricalRow(manyStops)],
        }
        assertWithinBand(model, 300, 1)
        assertWithinBand(model, 300, 2)
    })
})
