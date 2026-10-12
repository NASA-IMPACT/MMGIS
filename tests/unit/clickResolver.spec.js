import { describe, test, expect, vi } from 'vitest'
import { createClickResolver } from '../../src/essence/Basics/Map_/clickResolver'

/**
 * A click is resolved once, by draw order: the topmost layer under the
 * cursor with something there answers. The engine's pick is the floor; the
 * rasters above it are asked top-down. What matters is that a vector-only
 * click is reported unchanged and at once, that a raster above the pick
 * takes it with a value shaped as a feature, that nothing there means
 * falling through, and that a stale answer never goes out.
 */

const LATLNG = { lat: 35, lng: -97.5 }
const PIXEL = { x: 10, y: 20 }
const STATION = {
    feature: { type: 'Feature', properties: { site: 'A' }, geometry: null },
    layerId: 'stations',
    latlng: LATLNG,
    pixel: PIXEL,
}
const EMPTY = { feature: null, latlng: LATLNG, pixel: PIXEL }

const raster = (id, answer) => ({
    id,
    valueAt: vi.fn(async () => (typeof answer === 'function' ? answer() : answer)),
})

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('resolveClick', () => {
    test('a click with no raster to ask is the engine pick, returned in place', () => {
        const resolve = createClickResolver()
        expect(resolve(STATION, [])).toBe(STATION)
        expect(resolve(EMPTY, [])).toBe(EMPTY)
    })

    test('a pick with no position cannot ask a raster', () => {
        const resolve = createClickResolver()
        const naqfc = raster('naqfc', { value: 27 })
        expect(resolve({ feature: null }, [naqfc])).toEqual({ feature: null })
        expect(naqfc.valueAt).not.toHaveBeenCalled()
    })

    test('the first raster with a value takes the click, shaped as a feature', async () => {
        const resolve = createClickResolver()
        const tempo = raster('tempo', { value: null })
        const naqfc = raster('naqfc', { value: 27.005, band: 'b1', asOf: '2026-08-25T17:40:45Z' })
        const result = await resolve(STATION, [tempo, naqfc])
        expect(tempo.valueAt).toHaveBeenCalledWith(-97.5, 35)
        expect(result).toEqual({
            feature: {
                type: 'Feature',
                properties: {
                    value: 27.005,
                    location: '35.0000, -97.5000',
                    asOf: '2026-08-25T17:40:45Z',
                    band: 'b1',
                },
                geometry: { type: 'Point', coordinates: [-97.5, 35] },
            },
            layerId: 'naqfc',
            latlng: LATLNG,
            pixel: PIXEL,
        })
    })

    test('rasters are asked in the order given and the walk stops at the first value', async () => {
        const resolve = createClickResolver()
        const top = raster('top', { value: 1 })
        const under = raster('under', { value: 2 })
        const result = await resolve(EMPTY, [top, under])
        expect(result.layerId).toBe('top')
        expect(under.valueAt).not.toHaveBeenCalled()
    })

    test('no value anywhere falls through to the engine pick', async () => {
        const resolve = createClickResolver()
        const candidates = [raster('a', { value: null }), raster('b', null)]
        expect(await resolve(STATION, candidates)).toBe(STATION)
        expect(await resolve(EMPTY, candidates)).toBe(EMPTY)
    })

    test('a click superseded by a newer one resolves to nothing', async () => {
        const resolve = createClickResolver()
        let release
        const slow = raster('slow', () => new Promise((r) => (release = r)))
        const first = resolve(EMPTY, [slow])
        await settle()
        const second = resolve(EMPTY, [raster('fast', { value: 5 })])
        release({ value: 1 })
        expect(await first).toBeNull()
        expect((await second).layerId).toBe('fast')
    })
})
