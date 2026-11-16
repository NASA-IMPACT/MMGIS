import { describe, test, expect } from 'vitest'
import {
    comparisonCropRects,
    drawComparisonChrome,
    readCaptions,
    DEFAULT_CHROME_THEME,
} from '../../src/essence/Basics/MapEngines/Adapters/comparisonCapture.ts'

describe('comparisonCropRects', () => {
    // Swipe draws one camera three times: the primary (basemap) under both
    // followers, each clipped at the divider, as their clip-path is on screen.
    test('swipe: the base spans the width, left and right meet at the divider', () => {
        expect(comparisonCropRects('swipe', 0.3, 1000)).toEqual([
            { side: 'base', sx: 0, sw: 1000, dx: 0 },
            { side: 'left', sx: 0, sw: 300, dx: 0 },
            { side: 'right', sx: 300, sw: 700, dx: 300 },
        ])
    })

    // Each pane's canvas starts at its own left edge, so the right pane's
    // strip is its leading part, shifted to the divider in the output.
    test('side-by-side: the right pane\'s leading strip lands after the divider', () => {
        expect(comparisonCropRects('sideBySide', 0.3, 1000)).toEqual([
            { side: 'left', sx: 0, sw: 300, dx: 0 },
            { side: 'right', sx: 0, sw: 700, dx: 300 },
        ])
    })

    test('a divider at an edge leaves the empty side out', () => {
        expect(comparisonCropRects('sideBySide', 1, 1000)).toEqual([
            { side: 'left', sx: 0, sw: 1000, dx: 0 },
        ])
        expect(comparisonCropRects('swipe', 0, 1000).map((r) => r.side)).toEqual(['base', 'right'])
    })

    test('the split is a whole pixel, and the strips always add up to the width', () => {
        for (const pos of [0.1234, 0.5, 0.999]) {
            const rects = comparisonCropRects('sideBySide', pos, 999)
            expect(rects.reduce((sum, r) => sum + r.sw, 0)).toBe(999)
            rects.forEach((r) => expect(Number.isInteger(r.sw) && Number.isInteger(r.dx)).toBe(true))
        }
    })
})

const makeCtx = () => {
    const calls = []
    const ctx = {
        fillStyle: null,
        strokeStyle: null,
        lineWidth: 0,
        font: '',
        textBaseline: 'alphabetic',
        textAlign: 'start',
        shadowColor: '',
        shadowBlur: 0,
        save: () => calls.push({ op: 'save' }),
        restore: () => calls.push({ op: 'restore' }),
        fillRect: (...args) => calls.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle }),
        strokeRect: (...args) => calls.push({ op: 'strokeRect', args }),
        fillText: (...args) => calls.push({ op: 'fillText', args, font: ctx.font }),
        beginPath: () => calls.push({ op: 'beginPath' }),
        arc: (...args) => calls.push({ op: 'arc', args }),
        fill: () => calls.push({ op: 'fill', fillStyle: ctx.fillStyle }),
        stroke: () => calls.push({ op: 'stroke', lineWidth: ctx.lineWidth }),
    }
    return { ctx, calls }
}

describe('drawComparisonChrome', () => {
    test('draws the rule centred on the divider, full height, and the disc at mid-height', () => {
        const { ctx, calls } = makeCtx()
        drawComparisonChrome(ctx, { width: 1000, height: 500, dividerPos: 0.3, dpr: 1, captions: [] })
        const rule = calls.find((c) => c.op === 'fillRect')
        expect(rule.args).toEqual([298.5, 0, 3, 500])
        expect(rule.fillStyle).toBe(DEFAULT_CHROME_THEME.rule)
        const disc = calls.find((c) => c.op === 'arc')
        expect(disc.args.slice(0, 3)).toEqual([300, 250, 20])
        expect(calls.find((c) => c.op === 'fill').fillStyle).toBe(DEFAULT_CHROME_THEME.disc)
        expect(calls.find((c) => c.op === 'stroke').lineWidth).toBe(2)
    })

    // A retina capture is twice the CSS size, so every stroke doubles with it.
    test('scales the rule, disc and type by the device pixel ratio', () => {
        const { ctx, calls } = makeCtx()
        drawComparisonChrome(ctx, {
            width: 2000,
            height: 1000,
            dividerPos: 0.5,
            dpr: 2,
            captions: [{ text: 'PM2.5', x: 24, y: 24, width: 160, height: 44 }],
        })
        expect(calls.find((c) => c.op === 'fillRect').args).toEqual([997, 0, 6, 1000])
        expect(calls.find((c) => c.op === 'arc').args[2]).toBe(40)
        const label = calls.find((c) => c.op === 'fillText')
        expect(label.font).toMatch(/\b24px\b/)
        expect(label.args).toEqual(['PM2.5', 24 + 20, 24 + 22])
    })

    test('paints each caption as a chip at its measured box, then its text', () => {
        const { ctx, calls } = makeCtx()
        const captions = [
            { text: 'Left', x: 12, y: 12, width: 80, height: 26 },
            { text: 'Right', x: 512, y: 12, width: 90, height: 26 },
        ]
        drawComparisonChrome(ctx, { width: 1000, height: 500, dividerPos: 0.5, dpr: 1, captions })
        const chips = calls.filter((c) => c.op === 'fillRect').slice(1)
        expect(chips.map((c) => c.args)).toEqual([
            [12, 12, 80, 26],
            [512, 12, 90, 26],
        ])
        expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(['Left', 'Right'])
    })
})

describe('readCaptions', () => {
    const rect = (left, top, width, height) => ({ left, top, width, height })
    const container = (labels) => ({
        getBoundingClientRect: () => rect(100, 50, 1000, 500),
        querySelector: (selector) => labels[selector] ?? null,
    })

    test('measures each caption against the container and scales to output pixels', () => {
        const labels = {
            '.mmgis-comparison-label--left': { textContent: ' PM2.5 ', getBoundingClientRect: () => rect(112, 62, 80, 26) },
            '.mmgis-comparison-label--right': { textContent: 'Ozone', getBoundingClientRect: () => rect(612, 62, 90, 26) },
        }
        expect(readCaptions(container(labels), 2)).toEqual([
            { text: 'PM2.5', x: 24, y: 24, width: 160, height: 52 },
            { text: 'Ozone', x: 1024, y: 24, width: 180, height: 52 },
        ])
    })

    // A side with nothing to name draws no chip on screen (the empty chip is
    // display:none), so it gets none in the image either.
    test('leaves out a caption with no text or no box', () => {
        const labels = {
            '.mmgis-comparison-label--left': { textContent: '', getBoundingClientRect: () => rect(112, 62, 0, 0) },
            '.mmgis-comparison-label--right': { textContent: 'Ozone', getBoundingClientRect: () => rect(612, 62, 90, 26) },
        }
        expect(readCaptions(container(labels), 1).map((c) => c.text)).toEqual(['Ozone'])
        expect(readCaptions(container({}), 1)).toEqual([])
    })
})
