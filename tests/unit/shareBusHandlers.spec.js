import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing in this test needs
// the real viewers, so stub the aggregator to keep the mmgisAPI import chain
// parseable in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI, mmgisAPI_ } from '../../src/essence/mmgisAPI/mmgisAPI'

// Issue #143 review follow-up - the share capabilities are exposed on the
// request/provide bus (the plugin-facing channel) as well as as direct
// methods (the embedder-facing channel). The bus names must be registered
// from module load — before any mission loads — and each must delegate to
// the same implementation as its direct-method twin.

test.describe('share capabilities on the request/provide bus', () => {
    const saved = {}
    beforeEach(() => {
        saved.writeCoordinateURL = mmgisAPI_.writeCoordinateURL
        saved.getViewState = mmgisAPI_.getViewState
        saved.getMapScreenshot = mmgisAPI_.getMapScreenshot
        saved.copyText = mmgisAPI_.copyText
    })
    afterEach(() => {
        Object.assign(mmgisAPI_, saved)
    })

    test('all four handlers are registered at module load', () => {
        expect(mmgisAPI.hasHandler('map:writeCoordinateURL')).toBe(true)
        expect(mmgisAPI.hasHandler('map:getViewState')).toBe(true)
        expect(mmgisAPI.hasHandler('map:getScreenshot')).toBe(true)
        expect(mmgisAPI.hasHandler('app:copyText')).toBe(true)
    })

    test('map:writeCoordinateURL delegates to the direct implementation', async () => {
        mmgisAPI_.writeCoordinateURL = vi.fn(() => 'https://example.com/?v=1')
        await expect(
            mmgisAPI.request('map:writeCoordinateURL')
        ).resolves.toBe('https://example.com/?v=1')
        expect(mmgisAPI_.writeCoordinateURL).toHaveBeenCalledTimes(1)
    })

    test('map:getViewState delegates to the direct implementation', async () => {
        const state = {
            missionName: 'Msn',
            time: null,
            center: { lat: 1, lng: 2 },
            zoom: 5,
        }
        mmgisAPI_.getViewState = vi.fn(() => state)
        await expect(mmgisAPI.request('map:getViewState')).resolves.toBe(state)
    })

    test('map:getScreenshot delegates and propagates the async result', async () => {
        const screenshot = {
            blob: new Blob(['png'], { type: 'image/png' }),
            mimeType: 'image/png',
            extension: 'png',
            width: 640,
            height: 480,
        }
        mmgisAPI_.getMapScreenshot = vi.fn(() => Promise.resolve(screenshot))
        await expect(mmgisAPI.request('map:getScreenshot')).resolves.toBe(
            screenshot
        )
    })

    test('map:getScreenshot propagates rejection (no engine)', async () => {
        mmgisAPI_.getMapScreenshot = vi.fn(() =>
            Promise.reject(new Error('getMapScreenshot: no active map engine'))
        )
        await expect(mmgisAPI.request('map:getScreenshot')).rejects.toThrow(
            /no active map engine/
        )
    })

    test('app:copyText forwards the request payload as the text argument', async () => {
        mmgisAPI_.copyText = vi.fn(() => Promise.resolve(true))
        await expect(mmgisAPI.request('app:copyText', 'hello')).resolves.toBe(
            true
        )
        expect(mmgisAPI_.copyText).toHaveBeenCalledWith('hello')
    })

    test('pre-load behavior matches the direct method (null link)', async () => {
        // Before the mission finalizes, writeCoordinateURL returns null on
        // both channels — the bus must not mask or change that signal.
        expect(mmgisAPI.writeCoordinateURL()).toBe(null)
        await expect(mmgisAPI.request('map:writeCoordinateURL')).resolves.toBe(
            null
        )
    })
})
