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
let deferConfig

beforeEach(() => {
    subscriptions = []
    handlers = {}
    emit = vi.fn()
    deferConfig = null
    window.mmgisAPI = {
        on: (event, handler) => {
            subscriptions.push(event)
            handlers[event] = handler
            return vi.fn()
        },
        forPlugin: () => ({ emit }),
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
})

afterEach(() => {
    FetchStatsTool.destroy()
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
    FetchStatsTool.make('fetch-stats-target')

    expect(subscriptions).toEqual([AOI_READY])
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

    FetchStatsTool.destroy()
    deferConfig(ANALYSIS_LAYER)
    await flush()

    expect(emit).not.toHaveBeenCalled()
    // Reaching a dropped handle through a bare .emit throws, and the
    // subscription's catch would log that away instead of failing the
    // assertion above.
    expect(warn).not.toHaveBeenCalled()
})
