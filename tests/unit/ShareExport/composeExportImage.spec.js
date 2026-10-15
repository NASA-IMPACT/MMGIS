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

    describe('scale bar', () => {
        const compose = async (model, scaleBar, scale = 1) => {
            const calls = []
            const canvas = makeCanvas(calls)
            const result = await composeExportImage(screenshot, model, {
                createBitmap: async () => ({ close: vi.fn() }),
                createCanvas: () => canvas,
                scale,
                scaleBar,
            })
            return { calls, canvas, result }
        }
        const labels = (calls) =>
            calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])

        // A scale bar alone still decorates the map, and adds no band: the
        // image keeps the screenshot's size.
        test('draws the bar with no legend, without growing the image', async () => {
            const { calls, canvas, result } = await compose(null, {
                metersPerPixel: 1,
                units: 'metric',
            })
            expect([canvas.width, canvas.height]).toEqual([640, 480])
            expect(result.height).toBe(480)
            expect(calls[0].op).toBe('drawImage')
            expect(labels(calls)).toEqual(['100 m'])
        })

        test('draws exactly one bar alongside the legend band', async () => {
            const { calls } = await compose(bandModel, {
                metersPerPixel: 20,
                units: 'imperial',
            })
            expect(labels(calls).filter((t) => t === '1 mi')).toHaveLength(1)
            expect(labels(calls)).toContain('Displacement')
        })

        test('an unknown scale draws no bar', async () => {
            const createBitmap = vi.fn()
            expect(
                await composeExportImage(screenshot, null, {
                    createBitmap,
                    scaleBar: { metersPerPixel: 0, units: 'metric' },
                }),
            ).toBe(screenshot)
            expect(createBitmap).not.toHaveBeenCalled()
        })

        // The bar's metres-per-pixel is already in image pixels, so its rule
        // spans distance / metersPerPixel pixels at any DPR, and sits on the
        // map rather than in the band below it.
        test.each([1, 2])(
            'the rule spans the labelled distance at scale %s',
            async (scale) => {
                const metersPerPixel = 0.5
                const { calls } = await compose(
                    bandModel,
                    { metersPerPixel, units: 'metric' },
                    scale,
                )
                const label = labels(calls).find((t) => / m$/.test(t))
                const meters = Number(label.split(' ')[0])
                const rule = calls.find(
                    (c) =>
                        c.op === 'fillRect' &&
                        Math.abs(c.args[2] - meters / metersPerPixel) < 1e-9,
                )
                expect(rule).toBeDefined()
                expect(rule.args[1]).toBeLessThan(screenshot.height)
            },
        )

        test('the bar is never wider than a third of the image', async () => {
            const narrow = { ...screenshot, width: 150 }
            const calls = []
            await composeExportImage(narrow, null, {
                createBitmap: async () => ({ close: vi.fn() }),
                createCanvas: () => makeCanvas(calls),
                scale: 2,
                scaleBar: { metersPerPixel: 1, units: 'metric' },
            })
            // 50 px max -> 50 m.
            expect(labels(calls)).toEqual(['50 m'])
        })
    })
})
