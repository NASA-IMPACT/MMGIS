import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    colormapSourcesFor,
    colormapTableNow,
    findColormapRamp,
    isColormapReversible,
    listColormaps,
    peekColormapTable,
    registerColormapSource,
    resolveColormapColors,
    resolveColormapTable,
} from '../../src/essence/Basics/Colormaps/colormapResolver'
import { clearColormapCache } from '../../src/essence/Basics/Colormaps/titilerColormaps'
import {
    colormapResponseToTable,
    colormapTableToCss,
} from '../../src/essence/Basics/Colormaps/colormapTable'
import {
    getStandardColormapTable,
    STANDARD_COLORMAP_NAMES,
} from '../../src/essence/Basics/Colormaps/standardColormaps'

const BASE = 'https://titiler.test'
const ctx = { serviceUrl: BASE }

const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

/** viridis_r as a service publishes it: close to the mirror, not equal. */
const serviceViridisR = () => {
    const forward = fixture('eic/viridis.json')
    const reversed = {}
    for (let i = 0; i < 256; i++) reversed[i] = forward[255 - i]
    reversed[0] = [1, 2, 3, 255]
    return reversed
}

/** A stand-in tiling service answering from a name -> response map. */
const stubService = (responses) => {
    const fetch = vi.fn(async (url) => {
        const name = decodeURIComponent(
            url.slice(`${BASE}/colorMaps`.length).replace(/^\//, '')
        )
        const body = responses[name]
        return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 404, json: async () => ({ detail: 'Unknown colormap' }) }
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
}

const unreachable = () => {
    const fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
}

const EIC = () => ({
    '': fixture('eic/colorMaps.json'),
    viridis: fixture('eic/viridis.json'),
    viridis_r: serviceViridisR(),
    naqfc_pm25: fixture('eic/naqfc_pm25.json'),
})

const firstColour = (table) => Array.from(table.subarray(0, 4))

beforeEach(() => {
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('colormapSourcesFor', () => {
    test("asks the layer's service first, then the bundle", () => {
        expect(colormapSourcesFor(null, ctx).map((s) => s.id)).toEqual([
            `service:${BASE}`,
            'bundle',
        ])
    })

    test('leaves the service out when the layer has none', () => {
        expect(colormapSourcesFor(null, {}).map((s) => s.id)).toEqual(['bundle'])
        expect(colormapSourcesFor(null, { serviceUrl: null }).map((s) => s.id)).toEqual([
            'bundle',
        ])
    })

    test('a source naming no registered kind falls through to the bundle', () => {
        expect(colormapSourcesFor('nowhere', ctx).map((s) => s.id)).toEqual(['bundle'])
    })
})

describe('resolveColormapTable', () => {
    test("paints a ramp from the layer's service when it has it", async () => {
        stubService(EIC())
        const resolved = await resolveColormapTable({ name: 'naqfc_pm25' }, ctx)

        expect(resolved.sourceId).toBe(`service:${BASE}`)
        expect(resolved.table).toEqual(
            colormapResponseToTable('naqfc_pm25', fixture('eic/naqfc_pm25.json'))
        )
    })

    test('a standard ramp comes from the service too, when one is configured', async () => {
        stubService(EIC())
        const resolved = await resolveColormapTable({ name: 'viridis' }, ctx)
        expect(resolved.sourceId).toBe(`service:${BASE}`)
    })

    // Decision: a client-side renderer reversing a service ramp paints the
    // service's own `_r` table, so it matches what the service would paint.
    test("reverses with the service's `_r` table, not a mirror", async () => {
        stubService(EIC())
        const viaFlag = await resolveColormapTable({ name: 'viridis', reversed: true }, ctx)
        const viaName = await resolveColormapTable({ name: 'viridis_r' }, ctx)

        expect(firstColour(viaFlag.table)).toEqual([1, 2, 3, 255])
        expect(viaName.table).toBe(viaFlag.table)
        expect(viaFlag.key).toBe(`service:${BASE}|viridis_r`)
    })

    test('falls back to the bundle when the service cannot answer, mirroring there', async () => {
        unreachable()
        const resolved = await resolveColormapTable({ name: 'viridis', reversed: true }, ctx)

        expect(resolved.sourceId).toBe('bundle')
        expect(resolved.table).toBe(getStandardColormapTable('viridis_r'))
    })

    test('with no service, asks nothing and paints from the bundle', async () => {
        const fetch = unreachable()
        for (const name of STANDARD_COLORMAP_NAMES) {
            const resolved = await resolveColormapTable({ name }, {})
            expect(resolved.sourceId).toBe('bundle')
            expect(resolved.table).toBe(getStandardColormapTable(name))
        }
        expect(fetch).not.toHaveBeenCalled()
    })

    test('a ramp no source has paints as the fallback ramp', async () => {
        stubService(EIC())
        const resolved = await resolveColormapTable({ name: 'not-a-ramp' }, ctx)
        expect(resolved.sourceId).toBe('fallback')
        expect(resolved.table).toBe(getStandardColormapTable('viridis'))
        expect((await resolveColormapTable({ name: '' }, ctx)).sourceId).toBe('fallback')
    })

    test('a categorical ramp is never reversed', async () => {
        stubService(EIC())
        const resolved = await resolveColormapTable(
            { name: 'viridis', reversed: true, mode: 'categorical' },
            ctx
        )
        expect(resolved.reversed).toBe(false)
        expect(resolved.table).toEqual(
            colormapResponseToTable('viridis', fixture('eic/viridis.json'))
        )
    })

    test('caches per ramp: resolving twice costs one request', async () => {
        const fetch = stubService(EIC())
        await resolveColormapTable({ name: 'naqfc_pm25' }, ctx)
        await resolveColormapTable({ name: 'NAQFC_PM25' }, ctx)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    test('resolveColormapColors gives the same colours as CSS', async () => {
        stubService(EIC())
        const colors = await resolveColormapColors({ name: 'naqfc_pm25' }, ctx)
        expect(colors).toEqual(
            colormapTableToCss((await resolveColormapTable({ name: 'naqfc_pm25' }, ctx)).table)
        )
    })
})

describe('colormapTableNow', () => {
    // A service-only ramp is unknown until the service answers. The first
    // paint must not wait for it, so it uses the fallback, and the caller is
    // told once the real ramp is in so it can repaint.
    test('paints at once, then upgrades to the service ramp', async () => {
        stubService(EIC())
        const onUpgrade = vi.fn()

        const first = colormapTableNow({ name: 'naqfc_pm25' }, ctx, onUpgrade)
        expect(first.sourceId).toBe('fallback')

        await vi.waitFor(() => expect(onUpgrade).toHaveBeenCalledTimes(1))
        const [upgraded] = onUpgrade.mock.calls[0]
        expect(upgraded.sourceId).toBe(`service:${BASE}`)
        expect(upgraded.name).toBe('naqfc_pm25')

        // Settled now: the same call answers with the service ramp, and
        // starts nothing more.
        const again = colormapTableNow({ name: 'naqfc_pm25' }, ctx, onUpgrade)
        expect(again.key).toBe(upgraded.key)
        expect(peekColormapTable({ name: 'naqfc_pm25' }, ctx).settled).toBe(true)
    })

    test('a bundled ramp paints from the bundle first, then from the service', async () => {
        stubService(EIC())
        const onUpgrade = vi.fn()

        const first = colormapTableNow({ name: 'viridis', reversed: true }, ctx, onUpgrade)
        expect(first.sourceId).toBe('bundle')

        await vi.waitFor(() => expect(onUpgrade).toHaveBeenCalled())
        expect(firstColour(onUpgrade.mock.calls[0][0].table)).toEqual([1, 2, 3, 255])
    })

    test('does not repaint when the service cannot answer', async () => {
        unreachable()
        const onUpgrade = vi.fn()

        const first = colormapTableNow({ name: 'viridis' }, ctx, onUpgrade)
        await resolveColormapTable({ name: 'viridis' }, ctx)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(first.sourceId).toBe('bundle')
        expect(onUpgrade).not.toHaveBeenCalled()
        expect(peekColormapTable({ name: 'viridis' }, ctx)).toEqual({
            resolved: first,
            settled: true,
        })
    })

    test('with no service it is settled from the start', () => {
        const fetch = unreachable()
        const onUpgrade = vi.fn()
        expect(colormapTableNow({ name: 'magma' }, {}, onUpgrade).sourceId).toBe('bundle')
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('colormapTableNow: one upgrade per caller', () => {
    // A layer rebuilt several times while its service table loads is told
    // once that it arrived, not once per rebuild.
    test('asking again while the lookup is in flight adds no second upgrade', async () => {
        stubService(EIC())
        const onUpgrade = vi.fn()

        colormapTableNow({ name: 'naqfc_pm25' }, ctx, onUpgrade, 'layer-a')
        colormapTableNow({ name: 'naqfc_pm25' }, ctx, onUpgrade, 'layer-a')
        colormapTableNow({ name: 'NAQFC_PM25' }, ctx, onUpgrade, 'layer-a')
        // Another caller waiting on the same ramp is told too.
        const other = vi.fn()
        colormapTableNow({ name: 'naqfc_pm25' }, ctx, other, 'layer-b')

        await resolveColormapTable({ name: 'naqfc_pm25' }, ctx)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(onUpgrade).toHaveBeenCalledTimes(1)
        expect(other).toHaveBeenCalledTimes(1)
    })

    test('a key waits again once its lookup has landed', async () => {
        unreachable()
        const onUpgrade = vi.fn()
        colormapTableNow({ name: 'missing' }, ctx, onUpgrade, 'layer-a')
        await resolveColormapTable({ name: 'missing' }, ctx)
        await new Promise((resolve) => setTimeout(resolve, 0))

        // The failure is remembered for a while; once it expires a new ask
        // starts a new lookup and may be told again.
        clearColormapCache()
        stubService(EIC())
        colormapTableNow({ name: 'missing' }, ctx, onUpgrade, 'layer-a')
        expect(peekColormapTable({ name: 'missing' }, ctx).settled).toBe(false)
    })
})

describe('findColormapRamp', () => {
    const ramps = [
        { name: 'viridis', reversible: true },
        { name: 'foo_r', reversible: false },
    ]

    test('matches the exact name first, then the forward name of a `_r`', () => {
        expect(findColormapRamp(ramps, 'FOO_R')).toBe(ramps[1])
        expect(findColormapRamp(ramps, 'viridis_r')).toBe(ramps[0])
        expect(findColormapRamp(ramps, 'Viridis')).toBe(ramps[0])
        expect(findColormapRamp(ramps, 'foo')).toBeNull()
        expect(findColormapRamp(ramps, '')).toBeNull()
    })
})

describe('listColormaps', () => {
    test("lists the service's ramps when it can answer", async () => {
        stubService(EIC())
        const { sourceId, ramps } = await listColormaps(null, ctx)
        expect(sourceId).toBe(`service:${BASE}`)
        expect(ramps.map((r) => r.name)).toContain('naqfc_pm25')
    })

    // The list and each ramp are separate requests; one failing does not
    // take the other with it.
    test('a list that fails still leaves the service painting its ramps', async () => {
        const responses = EIC()
        delete responses['']
        stubService(responses)

        expect((await listColormaps(null, ctx)).sourceId).toBe('bundle')
        expect((await resolveColormapTable({ name: 'naqfc_pm25' }, ctx)).sourceId).toBe(
            `service:${BASE}`
        )
    })

    test('an unreachable service never empties the list', async () => {
        unreachable()
        const { sourceId, ramps } = await listColormaps(null, ctx)
        expect(sourceId).toBe('bundle')
        expect(ramps.map((r) => r.name)).toEqual(STANDARD_COLORMAP_NAMES)
    })

    test('with no service it lists the bundle and asks nothing', async () => {
        const fetch = unreachable()
        expect((await listColormaps(null, {})).ramps).toHaveLength(
            STANDARD_COLORMAP_NAMES.length
        )
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('isColormapReversible', () => {
    test('viridis reverses; a ramp published without `_r` does not', async () => {
        stubService(EIC())
        expect(await isColormapReversible({ name: 'viridis' }, ctx)).toBe(true)
        expect(await isColormapReversible({ name: 'viridis_r' }, ctx)).toBe(true)
        expect(await isColormapReversible({ name: 'naqfc_pm25' }, ctx)).toBe(false)
    })

    test('a categorical ramp never reverses', async () => {
        stubService(EIC())
        expect(
            await isColormapReversible({ name: 'viridis', mode: 'categorical' }, ctx)
        ).toBe(false)
    })

    test('answers from the bundle without a service', async () => {
        expect(await isColormapReversible({ name: 'viridis' }, {})).toBe(true)
        expect(await isColormapReversible({ name: 'cfastie' }, {})).toBe(false)
        expect(await isColormapReversible({ name: 'unknown' }, {})).toBe(false)
    })
})

// A source of another kind — a ramp written into the mission's config, say —
// is registered once and named by a layer. Nothing that consumes ramps learns
// about it.
describe('a third kind of source', () => {
    const inline = {
        id: 'inline:mission',
        list: async () => [{ name: 'mission_heat', reversible: false }],
        getTable: async (name) => (name === 'mission_heat' ? HEAT : null),
        peekTable: (name) => (name === 'mission_heat' ? HEAT : null),
    }
    const HEAT = new Uint8ClampedArray(256 * 4).fill(200)

    test('is resolved from once registered, and the bundle still backs it', async () => {
        const fetch = unreachable()
        const unregister = registerColormapSource('inline', () => inline)
        try {
            const request = { name: 'mission_heat', source: 'inline' }
            const resolved = await resolveColormapTable(request, ctx)
            expect(resolved.sourceId).toBe('inline:mission')
            expect(resolved.table).toBe(HEAT)
            expect(colormapTableNow(request, ctx).table).toBe(HEAT)
            expect((await listColormaps('inline', ctx)).ramps).toEqual([
                { name: 'mission_heat', reversible: false },
            ])
            expect(await isColormapReversible(request, ctx)).toBe(false)

            // A bundled ramp named against it still paints.
            const bundled = await resolveColormapTable({ name: 'magma', source: 'inline' }, ctx)
            expect(bundled.sourceId).toBe('bundle')
            // The service is not asked: the layer named its source.
            expect(fetch).not.toHaveBeenCalled()
        } finally {
            unregister()
        }
        expect(colormapSourcesFor('inline', ctx).map((s) => s.id)).toEqual(['bundle'])
    })
})
