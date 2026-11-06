import { describe, test, expect } from 'vitest'
import { drawScaleBar, measureScaleBar } from '../renderScaleBar.ts'

const makeCtx = () => {
    const fillRects = []
    const fillTexts = []
    const ctx = {
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: (...args) => fillRects.push({ args, fillStyle: ctx.fillStyle }),
        fillText: (...args) => fillTexts.push({ args, font: ctx.font }),
        measureText: (t) => ({ width: t.length * 6 }),
    }
    return { ctx, fillRects, fillTexts }
}

const fontPx = (font) => Number(font.match(/(\d+)px/)[1])

const model = { distance: 100, unit: 'm', label: '100 m', widthPx: 100 }

describe('drawScaleBar', () => {
    // The rule is the bar: its length is what the label promises, so it is
    // asserted to the pixel.
    test('draws a rule exactly widthPx long and the label', () => {
        const { ctx, fillRects, fillTexts } = makeCtx()
        drawScaleBar(ctx, model, { left: 10, bottom: 300, scale: 1 })
        const rule = fillRects.find(
            ({ args, fillStyle }) => args[2] === 100 && fillStyle !== null && !String(fillStyle).startsWith('rgba'),
        )
        expect(rule).toBeDefined()
        expect(fillTexts.map(({ args }) => args[0])).toEqual(['100 m'])
    })

    // A hi-DPI export carries a widthPx already measured in image pixels, so
    // the type grows with scale and the rule does not.
    test('scale grows the type but not the rule', () => {
        const { ctx, fillRects, fillTexts } = makeCtx()
        drawScaleBar(ctx, model, { left: 10, bottom: 300, scale: 2 })
        expect(fontPx(fillTexts[0].font)).toBe(24)
        expect(fillRects.some(({ args }) => args[2] === 100)).toBe(true)
        expect(fillRects.some(({ args }) => args[2] === 200)).toBe(false)
    })

    test('everything lies within the measured box above the anchor', () => {
        for (const scale of [1, 2, 3]) {
            const { ctx, fillRects, fillTexts } = makeCtx()
            const left = 10
            const bottom = 300
            const { width, height } = measureScaleBar(ctx, model, scale)
            drawScaleBar(ctx, model, { left, bottom, scale })
            for (const {
                args: [x, y, w, h],
            } of fillRects) {
                expect(x).toBeGreaterThanOrEqual(left)
                expect(x + w).toBeLessThanOrEqual(left + width + 1e-9)
                expect(y).toBeGreaterThanOrEqual(bottom - height - 1e-9)
                expect(y + h).toBeLessThanOrEqual(bottom + 1e-9)
            }
            const [{ args: [, , baseline], font }] = fillTexts
            expect(baseline - fontPx(font)).toBeGreaterThanOrEqual(bottom - height)
            expect(baseline).toBeLessThanOrEqual(bottom)
        }
    })

    test('a long label widens the backing past the rule', () => {
        const { ctx } = makeCtx()
        const short = { ...model, widthPx: 20, label: '5,000 km' }
        expect(measureScaleBar(ctx, short, 1).width).toBeGreaterThanOrEqual(
            '5,000 km'.length * 6,
        )
    })
})
