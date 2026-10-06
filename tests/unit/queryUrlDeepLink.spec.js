import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it, and
// with them a bundled THREE build, react-pdf and WebVR. Nothing here touches
// a viewer, so stub the aggregator to keep the QueryURL import chain light.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/pre/calls', () => ({ default: { api: vi.fn() } }))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import QueryURL from '../../src/essence/Ancillary/QueryURL'
import L_ from '../../src/essence/Basics/Layers_/Layers_'

// A deep link's currentTime lands in L_.FUTURES the way startTime and endTime
// do, as a moment, for TimeControl.init to seed the cursor from. A value
// moment cannot read is dropped with a warning rather than seeding garbage.

const setQuery = (query) => window.history.replaceState({}, '', '/?' + query)

let savedFutures
let warn

beforeEach(() => {
    savedFutures = L_.FUTURES
    L_.FUTURES = {}
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    L_.FUTURES = savedFutures
    warn.mockRestore()
    window.history.replaceState({}, '', '/')
})

test.describe('QueryURL.queryURL currentTime', () => {
    test('reads an ISO currentTime into FUTURES as a moment', () => {
        setQuery('mission=Test&currentTime=2026-08-05T12:00:00Z')

        QueryURL.queryURL()

        expect(L_.FUTURES.currentTime.isValid()).toBe(true)
        expect(L_.FUTURES.currentTime.toISOString()).toBe(
            '2026-08-05T12:00:00.000Z'
        )
    })

    test('reads a unix-millisecond currentTime', () => {
        setQuery('mission=Test&currentTime=1785585600000')

        QueryURL.queryURL()

        expect(L_.FUTURES.currentTime.toISOString()).toBe(
            '2026-08-01T12:00:00.000Z'
        )
    })

    test('drops an unreadable currentTime with a warning', () => {
        setQuery('mission=Test&currentTime=not-a-time')

        QueryURL.queryURL()

        expect(L_.FUTURES.currentTime).toBeUndefined()
        expect(warn).toHaveBeenCalledWith(
            'Invalid currentTime from deep link in the url'
        )
    })

    test('leaves FUTURES alone when the link has no currentTime', () => {
        setQuery('mission=Test&endTime=2026-08-20T00:00:00Z')

        QueryURL.queryURL()

        expect(L_.FUTURES.currentTime).toBeUndefined()
        expect(L_.FUTURES.endTime.isValid()).toBe(true)
    })
})
