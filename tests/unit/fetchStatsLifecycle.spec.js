import { test, expect, vi, beforeEach, afterEach } from 'vitest'

import FetchStatsTool from '../../src/essence/Tools/FetchStats/FetchStatsTool'

// FetchStats draws nothing, so the classic layout — which calls make() only for
// a tool the user opens from the toolbar — reaches it through initialize()
// alone. The modern layout calls both. One subscription either way is the whole
// point of the guard: two would answer one AOI selection with two analysis runs.

const AOI_READY = 'plugin:aoi:analysisAOIReady'

let offs
let subscriptions

beforeEach(() => {
    offs = []
    subscriptions = []
    window.mmgisAPI = {
        on: (event, handler) => {
            subscriptions.push(event)
            const off = vi.fn()
            offs.push(off)
            return off
        },
    }
    FetchStatsTool.api = { emit: vi.fn() }
})

afterEach(() => {
    FetchStatsTool.destroy()
    delete FetchStatsTool.api
    delete window.mmgisAPI
})

test('the classic layout gets a subscription from initialize() alone', () => {
    FetchStatsTool.initialize()

    expect(subscriptions).toEqual([AOI_READY])
})

test('the modern layout, calling both hooks, still subscribes once', () => {
    FetchStatsTool.initialize()
    FetchStatsTool.make('fetch-stats-target')

    expect(subscriptions).toEqual([AOI_READY])
})

test('a teardown unsubscribes and lets a reload subscribe again', () => {
    FetchStatsTool.initialize()

    FetchStatsTool.destroy()
    expect(offs).toHaveLength(1)
    expect(offs[0]).toHaveBeenCalled()

    FetchStatsTool.initialize()
    expect(subscriptions).toEqual([AOI_READY, AOI_READY])
})

// The handle is the controller's to release, so destroy() drops the reference
// rather than releasing it — and an analysis still in flight emits nothing.
test('a teardown drops the handle without releasing it', () => {
    const release = vi.fn()
    FetchStatsTool.api = { emit: vi.fn(), release }
    FetchStatsTool.initialize()

    FetchStatsTool.destroy()

    expect(release).not.toHaveBeenCalled()
    expect(FetchStatsTool._api).toBeNull()
})
