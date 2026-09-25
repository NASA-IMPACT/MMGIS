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
})
