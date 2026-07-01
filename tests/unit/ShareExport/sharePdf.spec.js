import { test, expect } from 'vitest'
import {
    computeCenteredPlacement,
    buildSharePdf,
} from '../../../src/essence/Tools/ShareExport/adapters/sharePdf.ts'

// Issue #144 - the PDF embeds the PNG snapshot centered on a portrait page,
// scaled to fit within margins while preserving aspect ratio.

test.describe('computeCenteredPlacement', () => {
    test('centers a landscape image and preserves its aspect ratio', () => {
        // 600x800 page, 1000x500 image (2:1), margin 50 -> avail 500x700.
        // Width-bound: scale = 500/1000 = 0.5 -> 500x250. Centered.
        const p = computeCenteredPlacement(600, 800, 1000, 500, 50)
        expect(p.width).toBeCloseTo(500)
        expect(p.height).toBeCloseTo(250)
        expect(p.width / p.height).toBeCloseTo(1000 / 500)
        expect(p.x).toBeCloseTo((600 - 500) / 2)
        expect(p.y).toBeCloseTo((800 - 250) / 2)
    })

    test('centers a portrait image, height-bound by the margins', () => {
        // 600x800 page, 400x800 image (1:2), margin 50 -> avail 500x700.
        // Height-bound: scale = 700/800 = 0.875 -> 350x700. Centered.
        const p = computeCenteredPlacement(600, 800, 400, 800, 50)
        expect(p.width).toBeCloseTo(350)
        expect(p.height).toBeCloseTo(700)
        expect(p.x).toBeCloseTo((600 - 350) / 2)
        expect(p.y).toBeCloseTo((800 - 700) / 2)
    })

    test('never scales an image up beyond its natural size', () => {
        const p = computeCenteredPlacement(600, 800, 100, 100, 50)
        expect(p.width).toBeCloseTo(100)
        expect(p.height).toBeCloseTo(100)
        // Still centered on the page.
        expect(p.x).toBeCloseTo((600 - 100) / 2)
        expect(p.y).toBeCloseTo((800 - 100) / 2)
    })
})

function makeMockDoc(pageWidth, pageHeight) {
    const calls = { addImage: [], save: [] }
    return {
        internal: {
            pageSize: {
                getWidth: () => pageWidth,
                getHeight: () => pageHeight,
            },
        },
        addImage(data, format, x, y, width, height) {
            calls.addImage.push({ data, format, x, y, width, height })
        },
        save(filename) {
            calls.save.push(filename)
        },
        _calls: calls,
    }
}

test.describe('buildSharePdf', () => {
    test('places the PNG centered on the page via addImage', () => {
        const doc = makeMockDoc(600, 800)
        const out = buildSharePdf('data:image/png;base64,FAKE', 1000, 500, {
            margin: 50,
            factory: () => doc,
        })

        expect(out).toBe(doc)
        expect(doc._calls.addImage.length).toBe(1)
        const call = doc._calls.addImage[0]
        expect(call.data).toBe('data:image/png;base64,FAKE')
        expect(call.format).toBe('PNG')
        expect(call.width).toBeCloseTo(500)
        expect(call.height).toBeCloseTo(250)
        // Centered: equal margins left/right and top/bottom.
        expect(call.x).toBeCloseTo((600 - call.width) / 2)
        expect(call.y).toBeCloseTo((800 - call.height) / 2)
    })
})
