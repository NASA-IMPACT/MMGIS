import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildLayerLegend } from '../../src/essence/Basics/Layers_/legend/buildLayerLegend'
import {
    registerColormapSource,
    resolveColormapTable,
} from '../../src/essence/Basics/Colormaps/colormapResolver'
import {
    colormapResponseToTable,
    colormapTableToCss,
} from '../../src/essence/Basics/Colormaps/colormapTable'
import { getStandardColormapCss } from '../../src/essence/Basics/Colormaps/standardColormaps'
import { clearColormapCache } from '../../src/essence/Basics/Colormaps/titilerColormaps'

const BASE = 'https://titiler.test'

const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

const raster = (fields = {}) => ({
    type: 'tile',
    url: 'COG:/data/a.tif',
    cogTransform: true,
    ...fields,
})

const stubService = (responses) => {
    const fetch = vi.fn(async (url) => {
        const name = decodeURIComponent(url.slice(`${BASE}/colorMaps/`.length))
        const body = responses[name]
        return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 404, json: async () => ({}) }
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

describe('buildLayerLegend: colormap rasters', () => {
    // A deployment's own ramp is legended as the service defines it, not as
    // the fallback.
    test("draws a service-only ramp from the layer's service", async () => {
        stubService({ naqfc_pm25: fixture('eic/naqfc_pm25.json') })

        const legend = await buildLayerLegend(
            raster({ cogColormap: 'naqfc_pm25', cogMin: 0, cogMax: 50 }),
            { serviceUrl: BASE }
        )

        expect(legend.type).toBe('gradient')
        expect(legend.stops).toEqual(
            colormapTableToCss(
                colormapResponseToTable('naqfc_pm25', fixture('eic/naqfc_pm25.json'))
            )
        )
        expect(legend.colormap).toBe('naqfc_pm25')
    })

    // The legend and the renderer ask the resolver the same question, so
    // they get the same table.
    test('draws exactly the table the resolver paints with', async () => {
        stubService({ viridis_r: fixture('eic/viridis.json') })
        const layer = raster({ cogColormap: 'viridis_r' })

        const legend = await buildLayerLegend(layer, { serviceUrl: BASE })
        const painted = await resolveColormapTable(
            { name: 'viridis', reversed: true },
            { serviceUrl: BASE }
        )
        expect(legend.stops).toEqual(colormapTableToCss(painted.table))
    })

    test('with no service, every bundled ramp legends from the bundle and nothing is asked', async () => {
        const fetch = stubService({})
        const legend = await buildLayerLegend(raster({ cogColormap: 'magma_r' }))
        expect(legend.stops).toEqual(getStandardColormapCss('magma', true))
        expect(fetch).not.toHaveBeenCalled()
    })

    test('an unreachable service still legends a bundled ramp', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
        )
        const legend = await buildLayerLegend(raster({ cogColormap: 'magma' }), {
            serviceUrl: BASE,
        })
        expect(legend.stops).toEqual(getStandardColormapCss('magma'))
    })

    test('a categorical ramp lists its codes as swatches', async () => {
        const table = new Uint8ClampedArray(256 * 4)
        table.set([255, 0, 0, 255], 1 * 4)
        table.set([0, 255, 0, 255], 2 * 4)
        // Code 3 unused: transparent, left out.
        table.set([0, 0, 255, 255], 4 * 4)
        const unregister = registerColormapSource('codes', () => ({
            id: 'codes',
            list: async () => [{ name: 'classes', reversible: false }],
            getTable: async () => table,
            peekTable: () => table,
        }))
        try {
            const legend = await buildLayerLegend(
                raster({
                    cogColormap: 'classes',
                    cogColormapMode: 'categorical',
                    cogColormapSource: 'codes',
                    cogMin: 1,
                    cogMax: 4,
                })
            )
            expect(legend.type).toBe('categorical')
            expect(legend.swatches).toEqual([
                { color: 'rgba(255, 0, 0, 1)', label: '1' },
                { color: 'rgba(0, 255, 0, 1)', label: '2' },
                { color: 'rgba(0, 0, 255, 1)', label: '4' },
            ])
        } finally {
            unregister()
        }
    })

    test('a categorical ramp with no range draws the ramp', async () => {
        const legend = await buildLayerLegend(
            raster({ cogColormap: 'tab10', cogColormapMode: 'categorical' })
        )
        expect(legend.type).toBe('gradient')
        expect(legend.stops).toEqual(getStandardColormapCss('tab10'))
    })

    // A new kind of source needs no change to the legend: a layer names it,
    // and the legend draws its ramp.
    test('draws a ramp from a registered third source', async () => {
        const fetch = stubService({})
        const HEAT = new Uint8ClampedArray(256 * 4).fill(200)
        const unregister = registerColormapSource('inline', () => ({
            id: 'inline',
            list: async () => [{ name: 'mission_heat', reversible: false }],
            getTable: async (name) => (name === 'mission_heat' ? HEAT : null),
            peekTable: (name) => (name === 'mission_heat' ? HEAT : null),
        }))
        try {
            const legend = await buildLayerLegend(
                raster({ cogColormap: 'mission_heat', cogColormapSource: 'inline' }),
                { serviceUrl: BASE }
            )
            expect(legend.stops).toEqual(colormapTableToCss(HEAT))
            expect(fetch).not.toHaveBeenCalled()
        } finally {
            unregister()
        }
    })
})
