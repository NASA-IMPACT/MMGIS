import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// providers read `L_.Map_`, which fina() assigns, so a bare stub is enough.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)
const { clearColormapCache } = await import(
    '../../src/essence/Basics/Colormaps/titilerColormaps'
)

/**
 * Core answers which ramps a layer can use, what they look like, and takes a
 * ramp or range change, so a ramp picker lists, previews and applies exactly
 * what core paints — for a raster and a vector layer alike.
 */

const TITILER = 'https://titiler.test'

const RASTER = {
    name: 'Displacement',
    type: 'tile',
    url: `titiler-url:${TITILER}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=s3://b/s.tif`,
    cogTransform: true,
    cogColormap: 'viridis',
    cogMin: 0,
    cogMax: 1,
}

const COLOR_BY = { mode: 'colormap', property: 'pm25', colormap: 'jet', min: 1, max: 18 }
const VECTOR = {
    name: 'PM25',
    type: 'MVTLayer',
    style: { fillColor: '#00ff00', colorBy: COLOR_BY },
}

let providers
let refreshLayer
let restyleLayer
let configChanges

const withLayers = (...layers) => {
    L_.layers.data = Object.fromEntries(layers.map((l) => [l.name, { ...l }]))
    L_.layers.layer = Object.fromEntries(layers.map((l) => [l.name, { id: l.name }]))
    L_.layers.on = Object.fromEntries(layers.map((l) => [l.name, true]))
    L_.layers.nameToUUID = {}
    providers = {}
    configChanges = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (event, payload) => {
            if (event === 'layers:configChanged') configChanges.push(payload)
        },
    }
    refreshLayer = vi.fn(() => true)
    restyleLayer = vi.fn(() => true)
    L_.fina(
        null,
        {
            engine: { engineType: MAP_ENGINE.DECKGL, refreshLayer },
            restyleLayer,
            nativeLayer: (layer) => layer,
        },
        null,
        null,
        null,
        { performTimeUrlReplacements: async (url) => url }
    )
}

beforeEach(() => {
    clearColormapCache()
    window.mmgisglobal = { SERVER: 'node' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.unstubAllGlobals()
})

afterAll(() => {
    delete window.mmgisAPI
    delete window.mmgisglobal
    L_.layers.data = {}
    L_.layers.layer = {}
    L_.layers.on = {}
})

describe('layers:setColormap', () => {
    test('a raster takes the ramp as its runtime colormap and is refreshed with it', async () => {
        withLayers(RASTER)
        const ok = await providers['layers:setColormap']({
            layerUUID: 'Displacement',
            colormap: 'plasma_r',
        })

        expect(ok).toBe(true)
        expect(L_.layers.data.Displacement.currentCogColormap).toBe('plasma_r')
        expect(refreshLayer.mock.calls[0][1].tileOptions.currentCogColormap).toBe(
            'plasma_r'
        )
        expect(configChanges).toEqual([
            { layerName: 'Displacement', keys: ['currentCogColormap'] },
        ])
    })

    test('a raster takes a range as its runtime bounds', async () => {
        withLayers(RASTER)
        await providers['layers:setColormap']({
            layerUUID: 'Displacement',
            min: 2,
            max: 5,
        })

        expect(L_.layers.data.Displacement).toMatchObject({
            currentCogMin: 2,
            currentCogMax: 5,
        })
        expect(refreshLayer.mock.calls[0][1].tileOptions).toMatchObject({
            currentCogMin: 2,
            currentCogMax: 5,
        })
    })

    test('a vector layer takes the ramp and direction into its colour setting and is restyled', async () => {
        withLayers(VECTOR)
        const ok = await providers['layers:setColormap']({
            layerUUID: 'PM25',
            colormap: 'viridis_r',
        })

        expect(ok).toBe(true)
        expect(L_.layers.data.PM25.style).toEqual({
            fillColor: '#00ff00',
            colorBy: { ...COLOR_BY, colormap: 'viridis', reversed: true },
        })
        // fina() also loads every colorBy layer's ramp once, so the call
        // checked is the last one.
        expect(restyleLayer.mock.lastCall[0].style.colorBy.colormap).toBe('viridis')
        expect(refreshLayer).not.toHaveBeenCalled()
        expect(L_.layers.data.PM25.currentCogColormap).toBeUndefined()
    })

    test('a vector layer takes a range into its colour setting', async () => {
        withLayers(VECTOR)
        await providers['layers:setColormap']({ layerUUID: 'PM25', min: 3, max: 5 })

        expect(L_.layers.data.PM25.style.colorBy).toEqual({ ...COLOR_BY, min: 3, max: 5 })
    })

    test('refuses a layer with nothing to change, an empty change, or an inverted range', async () => {
        withLayers(RASTER, { name: 'Plain', type: 'vector', style: {} })

        expect(
            await providers['layers:setColormap']({ layerUUID: 'Plain', colormap: 'jet' })
        ).toBe(false)
        expect(await providers['layers:setColormap']({ layerUUID: 'Displacement' })).toBe(
            false
        )
        expect(
            await providers['layers:setColormap']({
                layerUUID: 'Displacement',
                min: 5,
                max: 5,
            })
        ).toBe(false)
        expect(await providers['layers:setColormap']({ layerUUID: 'Nope', colormap: 'jet' })).toBe(
            false
        )
        expect(refreshLayer).not.toHaveBeenCalled()
        expect(configChanges).toEqual([])
    })
})

describe('layers:getColormaps', () => {
    test('lists the bundled ramps, both directions, for a layer with no service', async () => {
        withLayers(VECTOR)
        const names = await providers['layers:getColormaps']('PM25')

        expect(names).toContain('jet')
        expect(names).toContain('jet_r')
    })

    test('lists the layer’s service ramps when it has one', async () => {
        withLayers({ ...VECTOR, titilerUrl: TITILER })
        const fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ colorMaps: ['naqfc_pm25', 'viridis', 'viridis_r'] }),
        }))
        vi.stubGlobal('fetch', fetch)

        expect(await providers['layers:getColormaps']('PM25')).toEqual([
            'naqfc_pm25',
            'viridis',
            'viridis_r',
        ])
        expect(fetch.mock.calls[0][0]).toBe(`${TITILER}/colorMaps`)
    })

    test('falls back to the bundled ramps when the service list fails', async () => {
        withLayers({ ...VECTOR, titilerUrl: TITILER })
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })))

        expect(await providers['layers:getColormaps']('PM25')).toContain('jet_r')
    })

    test('answers null for an unknown layer', async () => {
        withLayers(VECTOR)
        expect(await providers['layers:getColormaps']('Nope')).toBeNull()
    })
})

describe('layers:getColormapColors', () => {
    test('draws a bundled ramp locally, `_r` reversed', async () => {
        withLayers(VECTOR)
        const forward = await providers['layers:getColormapColors']({
            layerUUID: 'PM25',
            colormap: 'jet',
        })
        const reversed = await providers['layers:getColormapColors']({
            layerUUID: 'PM25',
            colormap: 'jet_r',
        })

        expect(forward).toHaveLength(256)
        expect(reversed).toEqual([...forward].reverse())
    })

    // A swatch for a ramp nothing defines stays blank rather than showing the
    // fallback ramp a layer would paint with.
    test('answers null for a ramp no source holds', async () => {
        withLayers(VECTOR)
        expect(
            await providers['layers:getColormapColors']({
                layerUUID: 'PM25',
                colormap: 'not_a_ramp',
            })
        ).toBeNull()
    })
})
