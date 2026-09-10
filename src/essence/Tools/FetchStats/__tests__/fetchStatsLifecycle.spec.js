import { test, expect, vi, beforeEach, afterEach } from 'vitest'

import FetchStatsTool from '../FetchStatsTool'

// FetchStats renders nothing, so the classic layout reaches it through
// initialize() alone while the modern layout calls initialize() and then
// make(). One subscription either way is the point: two would answer a single
// AOI selection with two full analysis rounds.

const AOI_READY = 'plugin:aoi:analysisAOIReady'

const AOI = {
    type: 'Feature',
    properties: {},
    geometry: {
        type: 'Polygon',
        coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]],
    },
}

const ANALYSIS_LAYER = {
    display_name: 'Burn severity',
    variables: {
        analysis: {
            is_analysis_supported: true,
            itemUrl: 'https://titiler.example/item',
            assets: ['data'],
        },
    },
}

const flush = () => new Promise((resolve) => setTimeout(resolve))

let subscriptions
let handlers
let emit
let release
let deferConfig

beforeEach(() => {
    subscriptions = []
    handlers = {}
    emit = vi.fn()
    release = vi.fn()
    deferConfig = null
    window.mmgisAPI = {
        on: (event, handler) => {
            subscriptions.push(event)
            handlers[event] = handler
            return vi.fn()
        },
        request: (name) => {
            if (name === 'layers:getVisible') return Promise.resolve({ uuid: true })
            if (name === 'layers:getAll') return Promise.resolve(['uuid'])
            // Parks the analysis run mid-flight so the test can tear the
            // plugin down before any result comes back.
            return new Promise((resolve) => {
                deferConfig = resolve
            })
        },
    }
    // Stands in for the handle the tool controller mints and injects before
    // initialize() runs.
    FetchStatsTool.api = {
        address: 'fetchstats',
        on: vi.fn(() => vi.fn()),
        emit,
        provide: vi.fn(() => vi.fn()),
        request: vi.fn(() => Promise.resolve(null)),
        release,
    }
})

afterEach(() => {
    FetchStatsTool.destroy()
    FetchStatsTool.api = null
    delete window.mmgisAPI
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

test('the classic layout subscribes from initialize() alone', () => {
    FetchStatsTool.initialize()

    expect(subscriptions).toEqual([AOI_READY])
})

test('the modern layout, calling both start hooks, still subscribes once', () => {
    FetchStatsTool.initialize()
    FetchStatsTool.make('fetchstats-target')

    expect(subscriptions).toEqual([AOI_READY])
})

test('a reload subscribes again, once per live start', () => {
    FetchStatsTool.initialize()
    FetchStatsTool.destroy()
    FetchStatsTool.initialize()

    // destroy() clears the started flag, so the reload reaches api.on a
    // second time. A plugin left flagged as started would sit deaf for the
    // rest of the session.
    expect(subscriptions).toEqual([AOI_READY, AOI_READY])
})

test('an analysis resolving after teardown announces nothing', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ b1: {} }) }))
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    FetchStatsTool.initialize()

    handlers[AOI_READY]({ feature: AOI })
    await flush()

    // What the tool controller does on teardown: destroy(), then release the
    // handle and clear it off the instance.
    FetchStatsTool.destroy()
    FetchStatsTool.api.release()
    FetchStatsTool.api = null

    deferConfig(ANALYSIS_LAYER)
    await flush()

    expect(release).toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    // Reaching a cleared handle through a bare .emit throws, and the
    // subscription's catch would log that away instead of failing the
    // assertion above.
    expect(warn).not.toHaveBeenCalled()
})
