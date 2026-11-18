import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    normalizeServiceUrl,
    fetchRampNames,
    chooseRampNames,
    buildBundle,
    renderBundleModule,
    parseBundleModule,
    checkDrift,
    checkAllConvert,
} from '../../scripts/lib/colormap-bundle.mjs'
import { colormapResponseToTable } from '../../src/essence/Basics/Colormaps/colormapTable.ts'

const FIXTURES = 'tests/unit/fixtures/colormaps'
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const BASE = 'https://tiles.test/raster'

/**
 * A fetch that answers like a tiling service: `list` at /colorMaps and each
 * entry of `ramps` at /colorMaps/{name}; anything else is a 404.
 */
const fakeService = (list, ramps) => async (url) => {
    const path = url.slice(BASE.length)
    let body
    if (path === '/colorMaps') body = list
    else if (path.startsWith('/colorMaps/'))
        body = ramps[decodeURIComponent(path.slice('/colorMaps/'.length))]
    return body === undefined
        ? { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
        : { ok: true, status: 200, json: async () => body }
}

const vedaRamps = {
    viridis: read(`${FIXTURES}/veda/viridis.json`),
    tab10: read(`${FIXTURES}/veda/tab10.json`),
    nlcd: read(`${FIXTURES}/veda/nlcd.json`),
}
const vedaService = (ramps = vedaRamps) =>
    fakeService(read(`${FIXTURES}/veda/colorMaps.json`), ramps)
const tables = (ramps) =>
    Object.fromEntries(
        Object.entries(ramps).map(([name, response]) => [
            name,
            colormapResponseToTable(name, response),
        ])
    )

describe('normalizeServiceUrl', () => {
    test('requires an http(s) URL and drops trailing slashes', () => {
        expect(normalizeServiceUrl('https://openveda.cloud/api/raster/')).toBe(
            'https://openveda.cloud/api/raster'
        )
        expect(() => normalizeServiceUrl(undefined)).toThrow(/base URL/)
        expect(() => normalizeServiceUrl('openveda.cloud')).toThrow(/base URL/)
    })
})

describe('fetchRampNames', () => {
    test('reads the flat list VEDA serves', async () => {
        const names = await fetchRampNames(BASE, vedaService())
        expect(names).toContain('viridis')
        expect(names).toContain('viridis_r')
        expect(names).toContain('nlcd')
    })

    test('reads the per-ramp entries EIC serves', async () => {
        const names = await fetchRampNames(
            BASE,
            fakeService(read(`${FIXTURES}/eic/colorMaps.json`), {})
        )
        expect(names).toContain('naqfc_pm25')
        expect(names).toContain('accent_r')
    })

    test('fails on a list it cannot read', async () => {
        await expect(fetchRampNames(BASE, fakeService({ nope: 1 }, {}))).rejects.toThrow(
            /did not list any colormaps/
        )
    })
})

describe('chooseRampNames', () => {
    test('keeps the bundled names unless told otherwise', () => {
        expect(chooseRampNames({ current: ['viridis', 'jet'] })).toEqual(['jet', 'viridis'])
        expect(chooseRampNames({ current: ['viridis'], add: ['magma'] })).toEqual([
            'magma',
            'viridis',
        ])
        expect(chooseRampNames({ current: ['viridis'], names: ['jet'] })).toEqual(['jet'])
    })

    test('refuses an empty list, reversed ramps and non-service spellings', () => {
        expect(() => chooseRampNames({ current: [] })).toThrow(/No ramps to bundle/)
        expect(() => chooseRampNames({ names: ['viridis_r'] })).toThrow(/"viridis_r"/)
        expect(() => chooseRampNames({ names: ['RdBu'] })).toThrow(/"RdBu"/)
    })
})

describe('buildBundle', () => {
    test('fetches each chosen ramp as a table', async () => {
        const bundle = await buildBundle(BASE, ['tab10', 'viridis'], vedaService())
        expect(Object.keys(bundle)).toEqual(['tab10', 'viridis'])
        expect(bundle.viridis).toEqual(tables(vedaRamps).viridis)
    })

    test('fails when a chosen ramp is not on the service', async () => {
        await expect(
            buildBundle(BASE, ['viridis', 'naqfc_pm25'], vedaService())
        ).rejects.toThrow(/Not listed .*naqfc_pm25/)
    })

    test('reports the service detail for a ramp it refuses', async () => {
        const list = { colorMaps: ['viridis', 'gone'] }
        await expect(
            buildBundle(BASE, ['gone'], fakeService(list, vedaRamps))
        ).rejects.toThrow(`GET ${BASE}/colorMaps/gone answered 404: Not Found`)
    })

    test('fails, naming the ramp, when a response does not convert', async () => {
        await expect(
            buildBundle(
                BASE,
                ['viridis', 'tab10'],
                vedaService({ ...vedaRamps, tab10: { 0: [0, 0, 0, 255] } })
            )
        ).rejects.toThrow(/Colormap "tab10": expected 256 colours, got 1/)
    })
})

describe('bundle module', () => {
    test('round-trips through its source text', () => {
        const ramps = tables(vedaRamps)
        const source = renderBundleModule(ramps, { serviceUrl: BASE })
        expect(source).toContain(`Generated from ${BASE}/colorMaps (3 ramps)`)
        expect(source).toContain('export const STANDARD_COLORMAPS = {')
        expect(parseBundleModule(source)).toEqual(ramps)
    })

    test('refuses a ramp name it could not write as a key', () => {
        expect(() =>
            renderBundleModule({ "it's": tables(vedaRamps).viridis }, { serviceUrl: BASE })
        ).toThrow(/not a lowercase ramp name/)
    })

    test('reports a corrupt ramp by name', () => {
        expect(() => parseBundleModule("    'viridis': 'ff00',\n")).toThrow(/"viridis"/)
        expect(() => parseBundleModule('export const STANDARD_COLORMAPS = {}\n')).toThrow(
            /No ramps/
        )
    })
})

describe('checkDrift', () => {
    test('reports nothing when the bundle matches the service', async () => {
        expect(await checkDrift(BASE, tables(vedaRamps), { fetchImpl: vedaService() })).toEqual(
            []
        )
    })

    test('reports only ramps beyond the tolerance', async () => {
        const bundled = tables(vedaRamps)
        bundled.viridis = bundled.viridis.slice()
        bundled.viridis[0] += 1 // within the default tolerance
        bundled.tab10 = bundled.tab10.slice()
        bundled.tab10[40 * 4 + 1] += 9
        bundled.tab10[41 * 4 + 3] -= 3
        expect(await checkDrift(BASE, bundled, { fetchImpl: vedaService() })).toEqual([
            {
                name: 'tab10',
                problem: '2 of 256 colours differ by more than 1 (largest difference 9)',
            },
        ])
        expect(
            (await checkDrift(BASE, bundled, { tolerance: 0, fetchImpl: vedaService() })).map(
                (d) => d.name
            )
        ).toEqual(['tab10', 'viridis'])
    })

    test('reports ramps the service lacks or serves malformed', async () => {
        const bundled = { ...tables(vedaRamps), not_a_ramp: tables(vedaRamps).viridis }
        const drift = await checkDrift(BASE, bundled, {
            fetchImpl: vedaService({ ...vedaRamps, nlcd: [] }),
        })
        expect(drift).toEqual([
            { name: 'nlcd', problem: expect.stringMatching(/Colormap "nlcd": .*array/) },
            { name: 'not_a_ramp', problem: 'not listed by the service' },
        ])
    })
})

describe('checkAllConvert', () => {
    test('lists every ramp the service serves that does not convert', async () => {
        const list = { colorMaps: ['viridis', 'tab10', 'broken'] }
        const { count, failures } = await checkAllConvert(
            BASE,
            fakeService(list, { ...vedaRamps, broken: { 0: [0, 0, 0] } })
        )
        expect(count).toBe(3)
        expect(failures).toEqual([
            { name: 'broken', problem: 'Colormap "broken": expected 256 colours, got 1' },
        ])
    })
})

describe('the committed bundle', () => {
    const source = readFileSync('src/external/colormaps/standardColormaps.js', 'utf8')
    const bundled = parseBundleModule(source)

    test('holds the standard ramps only', () => {
        const legacy = Object.keys(read(`${FIXTURES}/legacy-lut.json`).ramps)
        expect(Object.keys(bundled).sort()).toEqual(legacy.sort())
        for (const custom of ['nlcd', 'epa-ghgi-ch4', 'naqfc_pm25', 'surface_temperature']) {
            expect(bundled).not.toHaveProperty(custom)
        }
    })

    test('is identical in the configure page copy', () => {
        expect(readFileSync('configure/src/external/standardColormaps.js', 'utf8')).toBe(source)
    })
})
