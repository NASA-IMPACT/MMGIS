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

const emptyModel = { missionName: null, headerLines: [], rows: [] }

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

describe('measureLegendBand', () => {
    test('is 0 for a model with no rows', () => {
        const { ctx } = makeCtx()
        expect(measureLegendBand(ctx, emptyModel, 400, 1)).toBe(0)
    })

    test('grows as rows are added', () => {
        const { ctx } = makeCtx()
        const oneRow = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow()],
        }
        const twoRows = {
            missionName: null,
            headerLines: [],
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
            headerLines: [],
            rows: [categoricalRow(manyStops)],
        }
        const wide = {
            missionName: null,
            headerLines: [],
            rows: [categoricalRow(manyStops.slice(0, 2))],
        }
        const hNarrow = measureLegendBand(ctx, narrow, 300, 1)
        const hWide = measureLegendBand(ctx, wide, 300, 1)
        expect(hNarrow).toBeGreaterThan(hWide)
    })

    test('a row with a date line is taller by exactly one label line', () => {
        const { ctx } = makeCtx()
        const without = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow()],
        }
        const with_ = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow({ dateLine: '2024-01-01 → 2024-02-01' })],
        }
        // LABEL_TEXT (11) + LINE_GAP (6), the same advance the draw pass makes
        // before the row's body.
        expect(measureLegendBand(ctx, with_, 400, 1)).toBe(
            measureLegendBand(ctx, without, 400, 1) + 17,
        )
        expect(measureLegendBand(ctx, with_, 400, 2)).toBe(
            measureLegendBand(ctx, without, 400, 2) + 34,
        )
    })

    test('each header line adds one label line to the band', () => {
        const { ctx } = makeCtx()
        const nameOnly = {
            missionName: 'M20',
            headerLines: [],
            rows: [gradientRow()],
        }
        const withLines = {
            missionName: 'M20',
            headerLines: ['Time cursor 2024-02-01', 'Exported 2024-03-04'],
            rows: [gradientRow()],
        }
        // LINE_GAP (6) + LABEL_TEXT (11) apiece, the same advance the draw
        // pass makes between header lines.
        expect(measureLegendBand(ctx, withLines, 400, 1)).toBe(
            measureLegendBand(ctx, nameOnly, 400, 1) + 34,
        )
    })

    test('a plain row is shorter than a gradient row by its bar and bounds', () => {
        const { ctx } = makeCtx()
        const plain = { missionName: null, headerLines: [], rows: [plainRow()] }
        const gradient = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow()],
        }
        expect(measureLegendBand(ctx, plain, 400, 1)).toBeLessThan(
            measureLegendBand(ctx, gradient, 400, 1),
        )
        // TITLE_TEXT (13) + LINE_GAP (6) + BAR_HEIGHT (12) + LINE_GAP (6) +
        // LABEL_TEXT (11) against a title line alone.
        expect(measureLegendBand(ctx, gradient, 400, 1)).toBe(
            measureLegendBand(ctx, plain, 400, 1) + 35,
        )
    })

    test('a plain row with a date line is taller by exactly one label line', () => {
        const { ctx } = makeCtx()
        const bare = { missionName: null, headerLines: [], rows: [plainRow()] }
        const dated = {
            missionName: null,
            headerLines: [],
            rows: [plainRow({ dateLine: 'Collected from 2016-05-01' })],
        }
        expect(measureLegendBand(ctx, dated, 400, 1)).toBe(
            measureLegendBand(ctx, bare, 400, 1) + 17,
        )
    })

    test('scale 2 doubles the measured height of the same model', () => {
        const { ctx } = makeCtx()
        const model = {
            missionName: 'Mission',
            headerLines: [],
            rows: [gradientRow()],
        }
        const h1 = measureLegendBand(ctx, model, 400, 1)
        const h2 = measureLegendBand(ctx, model, 400, 2)
        expect(h2).toBe(h1 * 2)
    })
})

describe('drawLegendBand', () => {
    test('paints the white band exactly at yTop covering width x bandHeight', () => {
        const { ctx, fillRectCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 600, 100, 1)
        expect(fillRectCalls[0].args).toEqual([0, 600, 400, 100])
    })

    test('draws the mission name, then whatever header lines the model built', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: 'M20',
            headerLines: ['Time cursor 2024-02-01', 'Exported 2024-03-04'],
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 0, 300, 1)
        const [mission, cursor, exported, title] = fillTextCalls
        expect(mission.args[0]).toBe('M20')
        expect(mission.font).toBe('bold 15px sans-serif')
        expect(cursor.args[0]).toBe('Time cursor 2024-02-01')
        expect(exported.args[0]).toBe('Exported 2024-03-04')
        // Header lines are the model's words: the renderer prints them in
        // order, in the label style, and only then starts the rows.
        expect(cursor.font).toBe('11px sans-serif')
        expect(cursor.args[1]).toBe(mission.args[1])
        expect(exported.args[2]).toBeGreaterThan(cursor.args[2])
        expect(title.args[0]).toBe('Displacement')
    })

    test('draws header lines even with no mission name', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: ['Exported 2024-03-04'],
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 0, 300, 1)
        expect(fillTextCalls[0].args[0]).toBe('Exported 2024-03-04')
    })

    test('clips a long header line rather than overflowing the band', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: ['E'.repeat(200)],
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 300, 0, 300, 1)
        expect(fillTextCalls[0].args[0].length).toBeLessThan(200)
        expect(fillTextCalls[0].args[0].endsWith('…')).toBe(true)
    })

    test('draws a row date line under its title in the smaller label style', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow({ dateLine: '2024-01-01 → 2024-02-01' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const [titleCall, timeCall] = fillTextCalls
        expect(titleCall.args[0]).toBe('Displacement')
        expect(timeCall.args[0]).toBe('2024-01-01 → 2024-02-01')
        // Same column as the title, on the line below it, in the label font.
        expect(timeCall.args[1]).toBe(titleCall.args[1])
        expect(timeCall.args[2]).toBeGreaterThan(titleCall.args[2])
        expect(timeCall.font).toBe('11px sans-serif')
    })

    test('draws no date line for a row without one', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow()],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        // Title, then the two gradient bounds — nothing between them.
        expect(fillTextCalls.map(({ args: [text] }) => text)).toEqual([
            'Displacement',
            '0',
            '10',
        ])
    })

    test('clips a long date line rather than overflowing the band', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
            rows: [gradientRow({ dateLine: 'T'.repeat(200) })],
        }
        drawLegendBand(ctx, model, 300, 0, 200, 1)
        const timeCall = fillTextCalls[1]
        expect(timeCall.args[0].length).toBeLessThan(200)
        expect(timeCall.args[0].endsWith('…')).toBe(true)
    })

    test('draws a plain row as a name alone, with no graphic', () => {
        const { ctx, fillTextCalls, fillRectCalls, gradients } = makeCtx()
        const model = { missionName: null, headerLines: [], rows: [plainRow()] }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        expect(fillTextCalls.map(({ args: [text] }) => text)).toEqual([
            'Basemap',
        ])
        expect(gradients).toHaveLength(0)
        // Only the band background and its top border are painted.
        expect(fillRectCalls).toHaveLength(2)
    })

    test('draws a plain row date line under its name', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
            rows: [plainRow({ dateLine: 'Collected from 2016-05-01' })],
        }
        drawLegendBand(ctx, model, 400, 0, 200, 1)
        const [titleCall, dateCall] = fillTextCalls
        expect(titleCall.args[0]).toBe('Basemap')
        expect(dateCall.args[0]).toBe('Collected from 2016-05-01')
        expect(dateCall.args[1]).toBe(titleCall.args[1])
        expect(dateCall.args[2]).toBeGreaterThan(titleCall.args[2])
        expect(dateCall.font).toBe('11px sans-serif')
    })

    test('draws min/max bounds with units via formatLegendBound', () => {
        const { ctx, fillTextCalls } = makeCtx()
        const model = {
            missionName: null,
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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
            headerLines: [],
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

    // The deepest painted content, ignoring the two full-height rects the
    // background and top border paint.
    const assertNoSlack = (model, width, scale) => {
        const { ctx, fillRectCalls } = makeCtx()
        const bandHeight = measureLegendBand(ctx, model, width, scale)
        const yTop = 50
        drawLegendBand(ctx, model, width, yTop, bandHeight, scale)
        const contentBottom = Math.max(
            ...fillRectCalls.slice(2).map(({ args: [, y, , h] }) => y + h),
        )
        expect(contentBottom).toBe(yTop + bandHeight - 16 * scale)
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
            headerLines: [],
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
            headerLines: [],
            rows: [categoricalRow(manyStops)],
        }
        assertWithinBand(model, 300, 1)
        assertWithinBand(model, 300, 2)
    })

    test('model where only some rows carry a date line, at scale 1 and 2', () => {
        const manyStops = Array.from({ length: 20 }, (_, i) => ({
            color: '#abc',
            label: `Category number ${i}`,
        }))
        const model = {
            missionName: 'M20',
            headerLines: [],
            rows: [
                gradientRow({ dateLine: '2015-03-13 → 2026-08-25' }),
                gradientRow({ title: 'Fixed scene' }),
                categoricalRow(manyStops, {
                    dateLine: '2015-03-13 → 2026-08-25',
                }),
                categoricalRow(manyStops.slice(0, 3)),
            ],
        }
        assertWithinBand(model, 300, 1)
        assertWithinBand(model, 300, 2)
        // And no slack either: the band ends one PAD below the deepest thing
        // drawn, so the extra line on the timed rows is counted exactly once.
        assertNoSlack(model, 300, 1)
        assertNoSlack(model, 300, 2)
    })

    test('mixed gradient, categorical and plain model at scale 1 and 2', () => {
        const manyStops = Array.from({ length: 20 }, (_, i) => ({
            color: '#abc',
            label: `Category number ${i}`,
        }))
        const model = {
            missionName: 'M20',
            headerLines: ['Time cursor 2024-02-01', 'Exported 2024-03-04'],
            rows: [
                gradientRow(),
                plainRow({ dateLine: 'Collected from 2016-05-01' }),
                categoricalRow(manyStops),
            ],
        }
        assertWithinBand(model, 300, 1)
        assertWithinBand(model, 300, 2)
        assertNoSlack(model, 300, 1)
        assertNoSlack(model, 300, 2)
    })
})
