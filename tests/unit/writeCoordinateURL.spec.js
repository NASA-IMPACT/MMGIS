import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the real
// viewers, so stub the aggregator to keep the QueryURL import chain parseable in
// the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/pre/calls', () => ({
    default: {
        api: vi.fn(),
    },
}))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import QueryURL from '../../src/essence/Ancillary/QueryURL'
import L_ from '../../src/essence/Basics/Layers_/Layers_'
import T_ from '../../src/essence/Basics/ToolController_/ToolController_'
import calls from '../../src/pre/calls'
import { isStaticBuild } from '../../src/pre/capabilities'

// Issue #143 - writeCoordinateURL() is the canonical share-link method: it must
// return the full view URL synchronously (a string, no backend call), and it
// must not throw in the modern layout, where UserInterface_.getPanelPercents()
// does not exist (classic/mobile only). The guard falls back to a map-only
// pane split there.

// The set of L_ / T_ properties writeCoordinateURL touches. We stub the minimal
// surface so every branch reaches the return, then snapshot/restore around each
// test since L_ and T_ are shared singletons.
const TOUCHED = [
    'Viewer_',
    'Map_',
    'Globe_',
    'mission',
    'site',
    'UserInterface_',
    'layers',
    'lastActiveFeature',
    'configData',
]

let saved
let savedGetToolsUrl

beforeEach(() => {
    vi.mocked(calls.api).mockReset()
    vi.mocked(isStaticBuild).mockReturnValue(false)

    saved = {}
    for (const key of TOUCHED) saved[key] = L_[key]
    savedGetToolsUrl = T_.getToolsUrl

    L_.Viewer_ = { getLocation: () => false, getLastImageId: () => false }
    L_.Map_ = {
        map: {
            getCenter: () => ({ lng: -122.5, lat: 37.8 }),
            getZoom: () => 6,
        },
    }
    L_.Globe_ = { litho: { getCenter: () => null, getCameras: () => null } }
    L_.mission = 'TestMission'
    L_.site = ''
    L_.layers = { on: {}, data: {}, opacity: {} }
    L_.lastActiveFeature = { layerName: null }
    L_.configData = { time: { enabled: false } }
    T_.getToolsUrl = () => false
})

afterEach(() => {
    for (const key of TOUCHED) L_[key] = saved[key]
    T_.getToolsUrl = savedGetToolsUrl
})

test.describe('QueryURL.writeCoordinateURL (issue #143)', () => {
    test('returns the full view URL synchronously as a string', () => {
        L_.UserInterface_ = {
            getPanelPercents: () => ({ viewer: 10, map: 70, globe: 20 }),
        }

        const url = QueryURL.writeCoordinateURL()

        // Synchronous string, not a Promise.
        expect(typeof url).toBe('string')
        expect(url).toContain('mission=TestMission')
        expect(url).toContain('mapLon=-122.5')
        expect(url).toContain('mapLat=37.8')
        expect(url).toContain('mapZoom=6')
        expect(url).toContain('panePercents=10,70,20')
    })

    test('does not throw in the modern layout and falls back to a map-only split', () => {
        // Modern layout: no getPanelPercents on UserInterface_.
        L_.UserInterface_ = {}

        let url
        expect(() => {
            url = QueryURL.writeCoordinateURL()
        }).not.toThrow()
        expect(url).toContain('panePercents=0,100,0')
    })
})

test.describe('QueryURL.getShareURL (issue #143)', () => {
    test('resolves with the long URL without shortening in static builds', async () => {
        vi.mocked(isStaticBuild).mockReturnValue(true)
        L_.UserInterface_ = {}

        const url = await QueryURL.getShareURL()

        expect(calls.api).not.toHaveBeenCalled()
        expect(url).toContain('mission=TestMission')
        expect(url).toContain('panePercents=0,100,0')
    })

    test('resolves with a short URL when the full-mode shortener succeeds', async () => {
        L_.UserInterface_ = {}
        vi.mocked(calls.api).mockImplementation((call, data, success) => {
            success({ body: { url: 'abc12' } })
        })

        const url = await QueryURL.getShareURL()

        expect(calls.api).toHaveBeenCalledWith(
            'shortener_shorten',
            { url: expect.stringContaining('?mission=TestMission') },
            expect.any(Function),
            expect.any(Function)
        )
        expect(url).toBe('http://localhost:3000/?s=abc12')
    })

    test('resolves with the long URL when shortening fails', async () => {
        L_.UserInterface_ = {}
        vi.mocked(calls.api).mockImplementation((call, data, success, error) => {
            error()
        })

        const url = await QueryURL.getShareURL()

        expect(url).toContain('mission=TestMission')
        expect(url).not.toContain('?s=')
    })
})
