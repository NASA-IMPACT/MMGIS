import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing in this test needs
// the real viewers, so stub the aggregator to keep the mmgisAPI import chain
// parseable in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'
import L_ from '../../src/essence/Basics/Layers_/Layers_'

// Issue #143 - mmgisAPI.getMapScreenshot() is the public, engine-aware entry
// point. It must delegate to the active map engine's captureScreenshot() and
// reject when no engine is loaded (rather than reach into a specific engine's
// DOM). L_ is a shared singleton, so we drive L_.Map_.engine directly.

test.describe('mmgisAPI.getMapScreenshot delegation (issue #143)', () => {
    let savedMap
    beforeEach(() => {
        savedMap = L_.Map_
    })
    afterEach(() => {
        L_.Map_ = savedMap
    })

    test('delegates to the active engine and returns its result', async () => {
        const screenshot = {
            blob: new Blob(['engine'], { type: 'image/png' }),
            mimeType: 'image/png',
            extension: 'png',
            width: 640,
            height: 480,
        }
        const capture = vi.fn(() =>
            Promise.resolve(screenshot)
        )
        L_.Map_ = { engine: { captureScreenshot: capture } }

        const result = await mmgisAPI.getMapScreenshot()

        expect(capture).toHaveBeenCalledTimes(1)
        expect(result).toBe(screenshot)
    })

    test('rejects when no engine is active', async () => {
        L_.Map_ = { engine: null }
        await expect(mmgisAPI.getMapScreenshot()).rejects.toThrow(
            /no active map engine/
        )
    })

    test('rejects when the engine has no captureScreenshot method', async () => {
        L_.Map_ = { engine: {} }
        await expect(mmgisAPI.getMapScreenshot()).rejects.toThrow(
            /no active map engine/
        )
    })
})
