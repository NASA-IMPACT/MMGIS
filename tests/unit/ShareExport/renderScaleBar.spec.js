import { describe, test, expect } from 'vitest'
import {
    drawNorthArrow,
    drawScaleBar,
    measureScaleBar,
    NORTH_ARROW_SIZE,
} from '../../../src/essence/Tools/_shared/legend/renderScaleBar.ts'

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

const bar = { label: '100 m', widthPx: 100 }

describe('drawScaleBar', () => {
    // The rule is the bar: its length is what the label promises, so it is
    // asserted to the pixel.
    test('draws a rule exactly widthPx long and the label', () => {
        const { ctx, fillRects, fillTexts } = makeCtx()
        drawScaleBar(ctx, bar, { left: 10, bottom: 300, scale: 1 })
        const rule = fillRects.find(
            ({ args, fillStyle }) => args[2] === 100 && fillStyle !== null && !String(fillStyle).startsWith('rgba'),
        )
        expect(rule).toBeDefined()
        expect(fillTexts.map(({ args }) => args[0])).toEqual(['100 m'])
    })

    // A hi-DPI export carries a widthPx already in image pixels, so the type
    // grows with scale and the rule does not.
    test('scale grows the type but not the rule', () => {
        const { ctx, fillRects, fillTexts } = makeCtx()
        drawScaleBar(ctx, bar, { left: 10, bottom: 300, scale: 2 })
        expect(fontPx(fillTexts[0].font)).toBe(24)
        expect(fillRects.some(({ args }) => args[2] === 100)).toBe(true)
        expect(fillRects.some(({ args }) => args[2] === 200)).toBe(false)
    })

    test('everything lies within the measured box above the anchor', () => {
        for (const scale of [1, 2, 3]) {
            const { ctx, fillRects, fillTexts } = makeCtx()
            const left = 10
            const bottom = 300
            const { width, height } = measureScaleBar(ctx, bar, scale)
            drawScaleBar(ctx, bar, { left, bottom, scale })
            for (const { args: [x, y, w, h] } of fillRects) {
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
        const short = { widthPx: 20, label: '5,000 km' }
        expect(measureScaleBar(ctx, short, 1).width).toBeGreaterThanOrEqual('5,000 km'.length * 6)
    })
})

describe('drawNorthArrow', () => {
    const makeArrowCtx = () => {
        const { ctx, fillRects, fillTexts } = makeCtx()
        const ops = []
        Object.assign(ctx, {
            textAlign: 'left',
            save: () => ops.push('save'),
            restore: () => ops.push('restore'),
            translate: (x, y) => ops.push(['translate', x, y]),
            rotate: (a) => ops.push(['rotate', a]),
            beginPath: () => ops.push('beginPath'),
            moveTo: (x, y) => ops.push(['moveTo', x, y]),
            lineTo: (x, y) => ops.push(['lineTo', x, y]),
            closePath: () => ops.push('closePath'),
            fill: () => ops.push('fill'),
        })
        return { ctx, fillRects, fillTexts, ops }
    }

    test('turns against the bearing about the centre of its square backing', () => {
        const { ctx, fillRects, ops } = makeArrowCtx()
        drawNorthArrow(ctx, { bearing: 45 }, { left: 20, bottom: 120, scale: 1 })
        expect(fillRects[0].args).toEqual([20, 120 - NORTH_ARROW_SIZE, NORTH_ARROW_SIZE, NORTH_ARROW_SIZE])
        expect(ops).toContainEqual(['translate', 20 + NORTH_ARROW_SIZE / 2, 120 - NORTH_ARROW_SIZE / 2])
        const [, angle] = ops.find((o) => o[0] === 'rotate')
        expect(angle).toBeCloseTo(-Math.PI / 4)
    })

    test('restores the context after drawing and labels the tip N', () => {
        const { ctx, fillTexts, ops } = makeArrowCtx()
        drawNorthArrow(ctx, { bearing: 0 }, { left: 0, bottom: 100, scale: 2 })
        expect(ops[0]).toBe('save')
        expect(ops.at(-1)).toBe('restore')
        expect(fillTexts.map(({ args }) => args[0])).toEqual(['N'])
        expect(fontPx(fillTexts[0].font)).toBe(20)
    })
})
