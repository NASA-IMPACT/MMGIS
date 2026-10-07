import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it, and
// with them a bundled THREE build, react-pdf and WebVR. Nothing in this
// test touches a viewer, so stub the aggregator to keep the QueryURL
// import chain light in the jsdom test env.
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
import TimeControl from '../../src/essence/Basics/TimeControl_/TimeControl'
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

// The share link carries the Time Control window as startTime/endTime and the
// cursor as currentTime, so a link opened later lands the scrubber where it
// was, not at the window's end.
test.describe('QueryURL.writeCoordinateURL time cursor', () => {
    let savedTimes

    beforeEach(() => {
        savedTimes = {
            startTime: TimeControl.startTime,
            endTime: TimeControl.endTime,
            currentTime: TimeControl.currentTime,
        }
        L_.UserInterface_ = {}
        TimeControl.startTime = '2026-07-20T00:00:00Z'
        TimeControl.endTime = '2026-08-20T00:00:00Z'
        TimeControl.currentTime = '2026-08-05T12:00:00Z'
    })

    afterEach(() => {
        Object.assign(TimeControl, savedTimes)
    })

    test('carries the cursor as currentTime beside the window', () => {
        L_.configData = { time: { enabled: true } }

        const url = QueryURL.writeCoordinateURL()

        expect(url).toContain('&startTime=2026-07-20T00:00:00Z')
        expect(url).toContain('&endTime=2026-08-20T00:00:00Z')
        expect(url).toContain('&currentTime=2026-08-05T12:00:00Z')
    })

    test('writes no time at all when the mission has time disabled', () => {
        L_.configData = { time: { enabled: false } }

        const url = QueryURL.writeCoordinateURL()

        expect(url).not.toContain('currentTime=')
        expect(url).not.toContain('endTime=')
    })
})

// The share link names the active basemap style, so a link opened later boots
// on the style that was showing rather than the mission's configured default.
test.describe('QueryURL.writeCoordinateURL basemap', () => {
    beforeEach(() => {
        L_.UserInterface_ = {}
    })

    test('carries the active basemap style by name', () => {
        L_.Map_.getActiveBasemap = () => ({
            name: 'Dark',
            style: 'mapbox://styles/mapbox/dark-v11',
        })

        expect(QueryURL.writeCoordinateURL()).toContain('&basemap=Dark')
    })

    test('percent-encodes a name with spaces', () => {
        L_.Map_.getActiveBasemap = () => ({
            name: 'Satellite Streets',
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
        })

        expect(QueryURL.writeCoordinateURL()).toContain(
            '&basemap=Satellite%20Streets'
        )
    })

    test('escapes & and # so the whole name survives as one value', () => {
        L_.Map_.getActiveBasemap = () => ({
            name: 'Roads & Labels #2',
            style: 'https://example.com/roads.json',
        })

        const url = QueryURL.writeCoordinateURL()

        expect(url).toContain('&basemap=Roads%20%26%20Labels%20%232')
        expect(new URL(url).searchParams.get('basemap')).toBe('Roads & Labels #2')
    })

    test('keeps every parameter that follows a # in the name', () => {
        L_.configData = { time: { enabled: true } }
        const savedTimes = {
            startTime: TimeControl.startTime,
            endTime: TimeControl.endTime,
            currentTime: TimeControl.currentTime,
        }
        TimeControl.currentTime = '2026-08-05T12:00:00Z'
        L_.Map_.getActiveBasemap = () => ({
            name: 'Top #1',
            style: 'https://example.com/top.json',
        })

        const params = new URL(QueryURL.writeCoordinateURL()).searchParams
        Object.assign(TimeControl, savedTimes)

        expect(params.get('basemap')).toBe('Top #1')
        expect(params.get('currentTime')).toBe('2026-08-05T12:00:00Z')
    })

    test('writes no basemap when the mission has none', () => {
        L_.Map_.getActiveBasemap = () => null

        expect(QueryURL.writeCoordinateURL()).not.toContain('basemap=')
    })

    test('writes no basemap against a core without the getter', () => {
        expect(QueryURL.writeCoordinateURL()).not.toContain('basemap=')
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
