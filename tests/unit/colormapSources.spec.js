import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    bundleSource,
    rampsFromNames,
    serviceSource,
} from '../../src/essence/Basics/Colormaps/colormapSources'
import { clearColormapCache } from '../../src/essence/Basics/Colormaps/titilerColormaps'
import {
    getStandardColormapTable,
    STANDARD_COLORMAP_NAMES,
} from '../../src/essence/Basics/Colormaps/standardColormaps'

const BASE = 'https://titiler.test'

const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

const listedNames = (service) => {
    const data = fixture(`${service}/colorMaps.json`)
    return data.colorMaps ?? data.colormaps.map((entry) => entry.id)
}

/** A stand-in tiling service answering from a name -> response map. */
const stubService = (responses) => {
    const fetch = vi.fn(async (url) => {
        const name = decodeURIComponent(url.slice(`${BASE}/colorMaps`.length).replace(/^\//, ''))
        const body = responses[name || '']
        return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 404, json: async () => ({ detail: 'Unknown colormap' }) }
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
}

beforeEach(() => {
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('rampsFromNames', () => {
    // On VEDA every matplotlib/cmocean ramp has a `_r` and none of the
    // deployment's own ramps does.
    test('folds `_r` variants into their forward ramp (VEDA)', () => {
        const ramps = rampsFromNames(listedNames('veda'))
        const byName = Object.fromEntries(ramps.map((r) => [r.name, r.reversible]))

        expect(byName.viridis).toBe(true)
        expect(byName['epa-ghgi-ch4']).toBe(false)
        expect(byName.nlcd).toBe(false)
        expect(byName.cfastie).toBe(false)
        expect(ramps.some((r) => r.name.endsWith('_r'))).toBe(false)
    })

    test("marks EIC's custom ramps as not reversible", () => {
        const byName = Object.fromEntries(
            rampsFromNames(listedNames('eic')).map((r) => [r.name, r.reversible])
        )
        expect(byName.naqfc_pm25).toBe(false)
        expect(byName.naqfc_o3).toBe(false)
        expect(byName.jet).toBe(true)
    })

    test('keeps a `_r` name with no forward ramp as a ramp of its own', () => {
        expect(rampsFromNames(['odd_r', 'b', 'b_r'])).toEqual([
            { name: 'b', reversible: true },
            { name: 'odd_r', reversible: false },
        ])
    })
})

describe('bundleSource', () => {
    test('lists every bundled ramp, reversible where the service publishes `_r`', async () => {
        const ramps = await bundleSource.list()
        expect(ramps.map((r) => r.name)).toEqual(STANDARD_COLORMAP_NAMES)
        const byName = Object.fromEntries(ramps.map((r) => [r.name, r.reversible]))
        expect(byName.viridis).toBe(true)
        expect(byName.cfastie).toBe(false)
        expect(byName.rplumbo).toBe(false)
    })

    // The bundle was generated from a service, so it offers reversing for
    // exactly the bundled ramps that service publishes a `_r` for.
    test.each([['veda'], ['eic']])('agrees with %s on which ramps reverse', async (service) => {
        const published = Object.fromEntries(
            rampsFromNames(listedNames(service)).map((r) => [r.name, r.reversible])
        )
        for (const { name, reversible } of await bundleSource.list()) {
            expect([name, reversible]).toEqual([name, published[name]])
        }
    })

    test('answers at once, a reversed ramp mirrored', async () => {
        expect(bundleSource.peekTable('viridis', true)).toBe(
            getStandardColormapTable('viridis_r')
        )
        expect(await bundleSource.getTable('RdBu', false)).toBe(
            getStandardColormapTable('rdbu')
        )
        expect(bundleSource.peekTable('naqfc_pm25', false)).toBeNull()
    })
})

describe('serviceSource', () => {
    test('lists the service ramps', async () => {
        stubService({ '': fixture('eic/colorMaps.json') })
        const ramps = await serviceSource(BASE).list()
        expect(ramps.find((r) => r.name === 'naqfc_pm25')).toEqual({
            name: 'naqfc_pm25',
            reversible: false,
        })
    })

    // The service's `_r` table is not always the forward one mirrored; a
    // client-side renderer has to paint what the service would.
    test('reads a reversed ramp from the service, not by mirroring', async () => {
        const forward = fixture('veda/viridis.json')
        const reversed = {}
        for (let i = 0; i < 256; i++) reversed[i] = forward[255 - i]
        reversed[0] = [1, 2, 3, 255]
        const fetch = stubService({ viridis: forward, viridis_r: reversed })

        const table = await serviceSource(BASE).getTable('viridis', true)
        expect(Array.from(table.subarray(0, 4))).toEqual([1, 2, 3, 255])
        expect(fetch).toHaveBeenCalledWith(`${BASE}/colorMaps/viridis_r`, expect.anything())
    })

    test('peeks without asking, then answers from what loaded', async () => {
        const fetch = stubService({ naqfc_pm25: fixture('eic/naqfc_pm25.json') })
        const source = serviceSource(BASE)

        expect(source.peekTable('naqfc_pm25', false)).toBeUndefined()
        expect(fetch).not.toHaveBeenCalled()
        const table = await source.getTable('naqfc_pm25', false)
        expect(source.peekTable('naqfc_pm25', false)).toBe(table)
    })

    test('is one source per service, however its URL is written', () => {
        expect(serviceSource(BASE)).toBe(serviceSource(`${BASE}/`))
        expect(serviceSource(BASE).id).toBe(`service:${BASE}`)
        expect(serviceSource('https://other.test').id).not.toBe(serviceSource(BASE).id)
    })
})
