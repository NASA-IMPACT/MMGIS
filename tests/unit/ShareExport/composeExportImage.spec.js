import { describe, test, expect, vi } from 'vitest'
import { composeExportImage } from '../../../src/essence/Tools/_shared/legend/composeExportImage.ts'
import { measureLegendBand } from '../../../src/essence/Tools/_shared/legend/renderLegendBand.ts'

// A minimal 2D-context stand-in: jsdom has no real canvas, so every drawing
// op the compositor and the legend renderer call is recorded instead of
// executed.
const makeCtx = (calls) => ({
    fillStyle: null,
    font: '',
    textBaseline: 'alphabetic',
    fillRect: (...args) => calls.push({ op: 'fillRect', args }),
    fillText: (...args) => calls.push({ op: 'fillText', args }),
    measureText: (t) => ({ width: t.length * 6 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: (...args) => calls.push({ op: 'drawImage', args }),
    translate: (...args) => calls.push({ op: 'translate', args }),
    rotate: (...args) => calls.push({ op: 'rotate', args }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: (...args) => calls.push({ op: 'fill', args }),
})

const makeCanvas = (calls) => ({
    width: 0,
    height: 0,
    getContext: () => makeCtx(calls),
    toBlob: (cb, type) => cb(new Blob(['composed'], { type })),
})

const screenshot = {
    blob: new Blob(['png'], { type: 'image/png' }),
    mimeType: 'image/png',
    extension: 'png',
    width: 640,
    height: 480,
}

const bandModel = {
    missionName: 'M20',
    headerFacts: [],
    rows: [{ kind: 'plain', title: 'Displacement' }],
}

describe('composeExportImage', () => {
    // Nothing to say about the map means nothing to append: the export is the
    // screenshot itself, never a screenshot plus an empty white strip.
    test('a model with no rows returns the screenshot untouched', async () => {
        const createBitmap = vi.fn()
        const empty = { missionName: null, headerFacts: [], rows: [] }
        for (const model of [empty, null]) {
            expect(
                await composeExportImage(screenshot, model, { createBitmap }),
            ).toBe(screenshot)
        }
        expect(createBitmap).not.toHaveBeenCalled()
    })

    // The canvas has to be sized explicitly: left at its 300x150 default it
    // crops the map, and never grown by the band height it crops the band.
    // Both produce a plausible-looking file, so the dimensions are asserted.
    test('appends the band below the map, at the full screenshot width', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        const bitmap = { close: vi.fn() }
        const result = await composeExportImage(screenshot, bandModel, {
            createBitmap: async () => bitmap,
            createCanvas: () => canvas,
            scale: 1,
        })
        // Measured with the same fake context the compositor uses, so this is
        // the height the band actually needs rather than a copied constant.
        const bandHeight = measureLegendBand(
            makeCtx([]),
            bandModel,
            screenshot.width,
            1,
        )
        expect(bandHeight).toBeGreaterThan(0)
        expect([canvas.width, canvas.height]).toEqual([
            screenshot.width,
            screenshot.height + bandHeight,
        ])
        expect(result.height).toBe(screenshot.height + bandHeight)
        expect(result.mimeType).toBe('image/png')
        expect(result.extension).toBe('png')
        expect(bitmap.close).toHaveBeenCalled()

        // The map is drawn at the origin and the band's own background starts
        // on its bottom edge, so the band never paints over the map.
        const [map] = calls.filter((c) => c.op === 'drawImage')
        expect(map.args.slice(1, 3)).toEqual([0, 0])
        const band = calls.find((c) => c.op === 'fillRect')
        expect(calls.indexOf(band)).toBeGreaterThan(calls.indexOf(map))
        expect(band.args.slice(0, 3)).toEqual([
            0,
            screenshot.height,
            screenshot.width,
        ])
    })

    // The bar is the one the screen showed, handed over by the capture, so it
    // is painted on the map itself, never appended: an export with the legend
    // off still carries it and keeps the map's own height.
    test('a captured scale bar is painted over the map, at the bottom-left, with no band', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        const withBar = { ...screenshot, scaleBar: { label: '500 m', widthPx: 160 } }
        const result = await composeExportImage(withBar, null, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => canvas,
            scale: 1,
        })
        expect([canvas.width, canvas.height]).toEqual([screenshot.width, screenshot.height])
        expect(result.height).toBe(screenshot.height)
        expect(result.scaleBar).toEqual(withBar.scaleBar)

        const [map] = calls.filter((c) => c.op === 'drawImage')
        const label = calls.find((c) => c.op === 'fillText')
        expect(label.args[0]).toBe('500 m')
        expect(calls.indexOf(label)).toBeGreaterThan(calls.indexOf(map))
        const rule = calls.find((c) => c.op === 'fillRect' && c.args[2] === 160)
        expect(rule).toBeDefined()
        // Inside the map, above its bottom edge.
        expect(rule.args[0]).toBeGreaterThan(0)
        expect(rule.args[1] + rule.args[3]).toBeLessThan(screenshot.height)
    })

    test('with both, the bar sits on the map and the band hangs below it', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        const withBar = { ...screenshot, scaleBar: { label: '2 km', widthPx: 90 } }
        await composeExportImage(withBar, bandModel, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => canvas,
            scale: 1,
        })
        const bandHeight = measureLegendBand(makeCtx([]), bandModel, screenshot.width, 1)
        expect(canvas.height).toBe(screenshot.height + bandHeight)
        const labels = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])
        expect(labels).toContain('2 km')
        expect(labels).toContain('Displacement')
    })

    // The arrow follows the bar along the bottom edge, so an export with
    // both reads bar-then-arrow, and one with only a compass still gets its
    // arrow at the corner.
    test('a captured compass is drawn as a north arrow to the right of the bar, turned by the bearing', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        const shot = {
            ...screenshot,
            scaleBar: { label: '500 m', widthPx: 160 },
            compass: { bearing: 90 },
        }
        await composeExportImage(shot, null, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => canvas,
            scale: 1,
        })
        expect(canvas.height).toBe(screenshot.height)
        const rule = calls.find((c) => c.op === 'fillRect' && c.args[2] === 160)
        const [{ args: [cx] }] = calls.filter((c) => c.op === 'translate')
        expect(cx).toBeGreaterThan(rule.args[0] + 160)
        const [{ args: [angle] }] = calls.filter((c) => c.op === 'rotate')
        expect(angle).toBeCloseTo(-Math.PI / 2)
        expect(calls.some((c) => c.op === 'fill')).toBe(true)
        expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(['500 m', 'N'])
    })

    test('a compass alone is drawn at the bottom-left margin', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        await composeExportImage({ ...screenshot, compass: { bearing: 0 } }, null, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => canvas,
            scale: 1,
        })
        const [{ args: [cx, cy] }] = calls.filter((c) => c.op === 'translate')
        expect(cx).toBeLessThan(screenshot.width / 4)
        expect(cy).toBeGreaterThan(screenshot.height * 0.9)
        expect(cy).toBeLessThan(screenshot.height)
    })

    test('a screenshot with scaleBar null and no rows is returned untouched', async () => {
        const createBitmap = vi.fn()
        const bare = { ...screenshot, scaleBar: null }
        expect(await composeExportImage(bare, null, { createBitmap })).toBe(bare)
        expect(createBitmap).not.toHaveBeenCalled()
    })
})
