import { test, expect, vi } from 'vitest'
import { composeExportImage } from '../../../src/essence/Tools/_shared/legend/composeExportImage.ts'
import { measureLegendBand } from '../../../src/essence/Tools/_shared/legend/renderLegendBand.ts'

// A minimal 2D-context stand-in: jsdom has no real canvas, so every drawing
// op the compositor and the legend renderer call is recorded instead of
// executed. Now a single context (composeExportImage measures and draws on
// the same canvas — see its "measure before resize" comment), but calls
// still record `fillStyle` at call time, not just the draw args, so a test
// can tell a real paint color from an incidental empty fillRect.
const makeCtx = (calls) => {
    const ctx = {
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: (...args) =>
            calls.push({ op: 'fillRect', args, fillStyle: ctx.fillStyle }),
        fillText: (...args) =>
            calls.push({ op: 'fillText', args, fillStyle: ctx.fillStyle }),
        measureText: (t) => ({ width: t.length * 6 }),
        createLinearGradient: (...args) => {
            const stops = []
            const gradient = {
                addColorStop: (offset, color) => stops.push({ offset, color }),
            }
            calls.push({ op: 'createLinearGradient', args, stops, gradient })
            return gradient
        },
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: (...args) =>
            calls.push({ op: 'drawImage', args, fillStyle: ctx.fillStyle }),
    }
    return ctx
}

const makeCanvas = (calls) => {
    const canvas = {
        _width: 0,
        _height: 0,
        get width() {
            return this._width
        },
        set width(v) {
            this._width = v
        },
        get height() {
            return this._height
        },
        set height(v) {
            this._height = v
        },
        getContext: () => makeCtx(calls),
        toBlob: (cb, type) => cb(new Blob(['composed'], { type })),
    }
    return canvas
}

const screenshot = {
    blob: new Blob(['png'], { type: 'image/png' }),
    mimeType: 'image/png',
    extension: 'png',
    width: 640,
    height: 480,
}

const gradientModel = {
    missionName: 'M20',
    headerLines: [],
    rows: [
        {
            kind: 'gradient',
            title: 'Displacement',
            colors: ['#000', '#fff'],
            min: 0,
            max: 10,
            unit: 'm',
        },
    ],
}

const emptyModel = { missionName: null, headerLines: [], rows: [] }

test.describe('composeExportImage', () => {
    test('an empty model returns the screenshot untouched', async () => {
        const createBitmap = vi.fn()
        const result = await composeExportImage(screenshot, emptyModel, {
            createBitmap,
        })
        expect(result).toBe(screenshot)
        expect(createBitmap).not.toHaveBeenCalled()
    })

    test('a null model returns the screenshot untouched', async () => {
        const createBitmap = vi.fn()
        const result = await composeExportImage(screenshot, null, {
            createBitmap,
        })
        expect(result).toBe(screenshot)
        expect(createBitmap).not.toHaveBeenCalled()
    })

    test('appends the band, preserving width/mimeType/extension', async () => {
        const calls = []
        const bitmap = { close: vi.fn() }
        const result = await composeExportImage(screenshot, gradientModel, {
            createBitmap: async () => bitmap,
            createCanvas: () => makeCanvas(calls),
            scale: 1,
        })
        expect(result.width).toBe(screenshot.width)
        expect(result.height).toBeGreaterThan(screenshot.height)
        expect(result.mimeType).toBe('image/png')
        expect(result.extension).toBe('png')
        expect(result.blob).toBeInstanceOf(Blob)
        expect(bitmap.close).toHaveBeenCalled()

        // drawImage (the screenshot) happens before the band's own draw ops.
        const drawImageIndex = calls.findIndex((c) => c.op === 'drawImage')
        const bandOpIndex = calls.findIndex(
            (c) => c.op === 'fillRect' || c.op === 'fillText',
        )
        expect(drawImageIndex).toBeGreaterThanOrEqual(0)
        expect(bandOpIndex).toBeGreaterThan(drawImageIndex)
        expect(calls[drawImageIndex].args[1]).toBe(0)
        expect(calls[drawImageIndex].args[2]).toBe(0)
    })

    // The canvas the band is drawn onto has to be sized explicitly: a canvas
    // left at its 300x150 default silently crops the map, and one never
    // grown by the band height crops the band. Both produce a plausible-
    // looking file, so the exact dimensions are asserted here.
    test('sizes the canvas to the screenshot plus the measured band', async () => {
        const calls = []
        const canvas = makeCanvas(calls)
        const result = await composeExportImage(screenshot, gradientModel, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => canvas,
            scale: 1,
        })
        // Measured with the same fake context the compositor uses, so this is
        // the height the band actually needs rather than a copied constant.
        const bandHeight = measureLegendBand(
            makeCtx([]),
            gradientModel,
            screenshot.width,
            1,
        )
        expect(bandHeight).toBeGreaterThan(0)
        expect(canvas.width).toBe(screenshot.width)
        expect(canvas.height).toBe(screenshot.height + bandHeight)
        expect(result.height).toBe(screenshot.height + bandHeight)
    })

    // The band is drawn immediately below the map, not over it.
    test('draws the band starting at the screenshot\'s bottom edge', async () => {
        const calls = []
        await composeExportImage(screenshot, gradientModel, {
            createBitmap: async () => ({ close: vi.fn() }),
            createCanvas: () => makeCanvas(calls),
            scale: 1,
        })
        const band = calls.find(
            (c) => c.op === 'fillRect' && c.fillStyle === '#ffffff',
        )
        expect(band.args[1]).toBe(screenshot.height)
    })

    test('paints the gradient bar with the model\'s actual colors', async () => {
        const calls = []
        const bitmap = { close: vi.fn() }
        await composeExportImage(screenshot, gradientModel, {
            createBitmap: async () => bitmap,
            createCanvas: () => makeCanvas(calls),
            scale: 1,
        })
        const gradients = calls.filter((c) => c.op === 'createLinearGradient')
        expect(gradients).toHaveLength(1)
        expect(gradients[0].stops.map((s) => s.color)).toEqual(['#000', '#fff'])
    })

    test('a null blob from toBlob rejects, and the bitmap is still closed', async () => {
        const bitmap = { close: vi.fn() }
        const canvas = makeCanvas([])
        canvas.toBlob = (cb) => cb(null)
        await expect(
            composeExportImage(screenshot, gradientModel, {
                createBitmap: async () => bitmap,
                createCanvas: () => canvas,
                scale: 1,
            }),
        ).rejects.toThrow('Legend compositing produced no image')
        expect(bitmap.close).toHaveBeenCalled()
    })
})
