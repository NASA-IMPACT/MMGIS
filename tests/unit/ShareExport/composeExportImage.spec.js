import { test, expect, vi } from 'vitest'
import { composeExportImage } from '../../../src/essence/Tools/_shared/adapters/composeExportImage.ts'

// A minimal 2D-context stand-in: jsdom has no real canvas, so every drawing
// op the compositor and the legend renderer call is recorded instead of
// executed. Shared across the measuring and drawing contexts a real canvas
// would give, since both are only ever read here, not rendered.
const makeCtx = (calls) => ({
    fillStyle: null,
    font: '',
    textBaseline: 'alphabetic',
    fillRect: (...args) => calls.push({ op: 'fillRect', args }),
    fillText: (...args) => calls.push({ op: 'fillText', args }),
    measureText: (t) => ({ width: t.length * 6 }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: (...args) => calls.push({ op: 'drawImage', args }),
})

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
    timeLabel: null,
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

const emptyModel = { missionName: null, timeLabel: null, rows: [] }

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
