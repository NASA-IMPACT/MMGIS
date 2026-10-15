import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it, and
// with them a bundled THREE build, react-pdf and WebVR. Nothing in this
// test touches a viewer, so stub the aggregator to keep the mmgisAPI
// import chain light in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'
import L_ from '../../src/essence/Basics/Layers_/Layers_'

// Issue #143 - readiness guards on the public share-link surface, and the
// getViewState() metadata plugins use for provenance-rich export filenames.
// L_ is a shared singleton, so we drive its fields directly and restore.

const TOUCHED = ['Map_', 'configData', 'TimeControl_']

test.describe('mmgisAPI.writeCoordinateURL readiness guard (issue #143)', () => {
    let saved
    beforeEach(() => {
        saved = {}
        TOUCHED.forEach((k) => (saved[k] = L_[k]))
    })
    afterEach(() => {
        TOUCHED.forEach((k) => (L_[k] = saved[k]))
        mmgisAPI.map = null
    })

    test('returns null before mission finalization instead of throwing', () => {
        // Before fina() runs, mmgisAPI.map is unset and QueryURL's
        // dereferences (L_.Viewer_, L_.Map_.map, ...) would TypeError.
        mmgisAPI.map = null
        expect(mmgisAPI.writeCoordinateURL()).toBeNull()
    })
})

test.describe('mmgisAPI.getViewState (issue #143)', () => {
    let saved
    beforeEach(() => {
        saved = {}
        TOUCHED.forEach((k) => (saved[k] = L_[k]))
    })
    afterEach(() => {
        TOUCHED.forEach((k) => (L_[k] = saved[k]))
    })

    test('returns all-null fields when nothing has loaded', () => {
        L_.Map_ = null
        L_.configData = null
        L_.TimeControl_ = null
        expect(mmgisAPI.getViewState()).toEqual({
            missionName: null,
            time: null,
            center: null,
            zoom: null,
            bearing: null,
            pitch: null,
        })
    })

    test('reports mission, time, center, and zoom once loaded', () => {
        L_.Map_ = {
            map: {
                getCenter: () => ({ lat: 4.5, lng: 137.4 }),
                getZoom: () => 7,
            },
        }
        L_.configData = { msv: { mission: 'MSL' } }
        L_.TimeControl_ = { currentTime: '2026-07-01T12:00:00Z' }
        expect(mmgisAPI.getViewState()).toEqual({
            missionName: 'MSL',
            time: '2026-07-01T12:00:00Z',
            center: { lat: 4.5, lng: 137.4 },
            zoom: 7,
            bearing: null,
            pitch: null,
        })
    })

    test('reports the engine bearing and pitch', () => {
        L_.Map_ = {
            map: {
                getCenter: () => ({ lat: 4.5, lng: 137.4 }),
                getZoom: () => 7,
            },
            engine: {
                getViewState: () => ({
                    center: { lat: 4.5, lng: 137.4 },
                    zoom: 7,
                    bearing: -42,
                    pitch: 35,
                }),
            },
        }
        expect(mmgisAPI.getViewState()).toMatchObject({
            bearing: -42,
            pitch: 35,
        })
    })

    test('reports a projection bearing with zero pitch on an engine that cannot tilt', () => {
        L_.Map_ = {
            map: {
                getCenter: () => ({ lat: -80, lng: 0 }),
                getZoom: () => 3,
            },
            engine: {
                getViewState: () => ({
                    center: { lat: -80, lng: 0 },
                    zoom: 3,
                    bearing: 120,
                    pitch: 0,
                }),
            },
        }
        expect(mmgisAPI.getViewState()).toMatchObject({
            bearing: 120,
            pitch: 0,
        })
    })

    test('leaves bearing and pitch null, and still answers the rest, when the engine throws', () => {
        L_.Map_ = {
            map: {
                getCenter: () => ({ lat: 4.5, lng: 137.4 }),
                getZoom: () => 7,
            },
            engine: {
                getViewState: () => {
                    throw new Error('no view yet')
                },
            },
        }
        expect(mmgisAPI.getViewState()).toMatchObject({
            center: { lat: 4.5, lng: 137.4 },
            zoom: 7,
            bearing: null,
            pitch: null,
        })
    })
})

test.describe('mmgisAPI.resetNorth', () => {
    test('asks the map for map:resetNorth', async () => {
        const handler = vi.fn(() => true)
        const off = mmgisAPI.provide('map:resetNorth', handler)
        try {
            await expect(mmgisAPI.resetNorth()).resolves.toBe(true)
            expect(handler).toHaveBeenCalledTimes(1)
        } finally {
            off()
        }
    })
})
