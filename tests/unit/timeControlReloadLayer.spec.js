import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

/**
 * TimeControl.reloadLayer must recompile a raster tile layer's URL on every
 * time change regardless of which engine's type name the config uses:
 * Leaflet configs say `tile`, deck.gl configs say `TileLayer`/`BitmapLayer`.
 *
 * Scope is raster only. Tile3DLayer and PointCloudLayer are built through
 * makeTileLayer too but stay on the refresh path — see issue #230.
 */

const refreshLayer = vi.fn(() => true)

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({
    default: {
        engine: {
            engineType: MAP_ENGINE.DECKGL,
            refreshLayer: (...args) => refreshLayer(...args),
        },
        // A distinct, pre-existing Map_-level path (not Map_.engine.refreshLayer)
        // used by the non-raster fallback below. Out of scope for this task.
        refreshLayer: vi.fn(async () => true),
    },
}))

vi.mock('../../src/essence/Basics/Layers_/Layers_', () => ({
    default: {
        missionPath: '',
        configData: {},
        FUTURES: {},
        layers: { data: {}, layer: {}, on: {}, opacity: {}, filters: {} },
        asLayerUUID: (name) => name,
        // Mirrors the real getUrl's COG: prefix stripping (the resolved
        // file URL a deckRaster layer reads directly).
        getUrl: (type, url) => (url.startsWith('COG:') ? url.slice(4) : url),
        transformStacUrl: (url) => url,
        timeFilterVectorLayer: vi.fn(),
    },
}))

const timeConfig = {
    enabled: true,
    type: 'requery',
    format: '%Y%m',
    start: '2022-01-15T00:00:00Z',
    end: '2022-06-15T00:00:00Z',
}

const makeNO2Layer = (type) => ({
    name: 'NO2 Monthly',
    type,
    url: 'https://openveda.cloud/api/raster/collections/no2-monthly/items/OMI_trno2_0.10x0.10_{time}_Col3_V4.nc/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=cog_default',
    tileformat: 'wmts',
    controlled: false,
    time: { ...timeConfig },
})

const makeTilesetLayer = (type) => ({
    name: 'Terrain Tileset',
    type,
    url: 'https://example.com/tilesets/{time}/tileset.json',
    controlled: false,
    time: { ...timeConfig },
})

describe('TimeControl.reloadLayer with the deck.gl engine', () => {
    let TimeControl
    let Map_
    let L_

    // Reset the module registry so the TimeControl singleton and the mocked
    // layer registry start clean for each case rather than carrying state.
    beforeEach(async () => {
        vi.resetModules()
        refreshLayer.mockClear()
        TimeControl = (await import('../../src/essence/Basics/TimeControl_/TimeControl'))
            .default
        Map_ = (await import('../../src/essence/Basics/Map_/Map_')).default
        L_ = (await import('../../src/essence/Basics/Layers_/Layers_')).default
    })

    // A deck.gl layer object has no Leaflet `refresh`/`options`.
    const registerDeckLayer = (layer) => {
        L_.layers.data[layer.name] = layer
        L_.layers.layer[layer.name] = { id: layer.name }
        L_.layers.on[layer.name] = true
    }

    // The call site hands the engine the uncompiled tile source URL plus
    // tileOptions — the {time} substitution is the engine's job now (deck.gl
    // bakes it in via compileTileUrl; Leaflet recompiles it per tile), so
    // what's asserted here is that the *formatted* time reaches ctx via
    // tileOptions, not that ctx.url already has it substituted.
    test.each([['tile'], ['TileLayer'], ['BitmapLayer']])(
        'passes the formatted time for a %s layer without pre-compiling the URL',
        async (type) => {
            const layer = makeNO2Layer(type)
            registerDeckLayer(layer)

            await TimeControl.reloadLayer(layer)

            expect(refreshLayer).toHaveBeenCalledTimes(1)
            const [name, ctx] = refreshLayer.mock.calls[0]
            expect(name).toBe('NO2 Monthly')
            expect(ctx.url).toContain('{time}')
            expect(ctx.tileOptions.time).toBe('202206')
        }
    )

    // Map_ routes these to makeTileLayer alongside the raster types, but the
    // reload gate is raster-only, so they take the refresh path and their
    // `{time}` placeholder is left unsubstituted. Pinned as the current,
    // deliberate boundary rather than as desired behaviour — see issue #230.
    test.each([['Tile3DLayer'], ['PointCloudLayer']])(
        'leaves a %s layer on the refresh path',
        async (type) => {
            const layer = makeTilesetLayer(type)
            registerDeckLayer(layer)

            await TimeControl.reloadLayer(layer)

            expect(refreshLayer).not.toHaveBeenCalled()
            expect(Map_.refreshLayer).toHaveBeenCalled()
        }
    )

    // A colormap picked in the Layer Manager lives on the config as
    // `currentCogColormap`. A time change recompiles the URL from the config
    // alone, so the pick has to survive that recompile. The call site no
    // longer bakes tileOptions into the URL itself — the engine's registered
    // refresher does that — so the pick travels through ctx.tileOptions.
    test('keeps a user-picked colormap when the time changes', async () => {
        const layer = {
            name: 'CO2 Concentration',
            type: 'TileLayer',
            url: 'titiler-url:https://example.com/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png',
            tileformat: 'wmts',
            controlled: false,
            cogTransform: true,
            cogColormap: 'viridis',
            currentCogColormap: 'magma',
            time: { ...timeConfig },
        }
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        const [, ctx] = refreshLayer.mock.calls[0]
        expect(ctx.tileOptions.currentCogColormap).toBe('magma')
        expect(ctx.url).not.toContain('colormap_name')
    })

    test('leaves the layer config URL unmutated so the next reload re-substitutes', async () => {
        const layer = makeNO2Layer('TileLayer')
        const originalUrl = layer.url
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(layer.url).toBe(originalUrl)
    })

    // The point of this test: a deckRaster COG config and a plain tile config
    // differ only in `cogRendererMode`. If the call site still branched on
    // that (or on engine/renderer type) to decide how to update the layer,
    // the two calls would differ in shape. They must not — the registered
    // refresher, not the call site, owns "how".
    test('a deckRaster layer takes the same call as a plain tile layer', async () => {
        const plain = makeNO2Layer('tile')
        registerDeckLayer(plain)
        await TimeControl.reloadLayer(plain)
        const plainCall = refreshLayer.mock.calls[0]

        refreshLayer.mockClear()

        // Differs only in how it renders — the call site must not notice.
        const cog = { ...makeNO2Layer('tile'), cogRendererMode: 'deckRaster' }
        registerDeckLayer(cog)
        await TimeControl.reloadLayer(cog)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(Object.keys(refreshLayer.mock.calls[0][1]).sort()).toEqual(
            Object.keys(plainCall[1]).sort()
        )
    })

    test('a vector tile layer takes the refresh path, not the tile pipeline', async () => {
        const layer = {
            name: 'Roads',
            type: 'MVTLayer',
            url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
            controlled: false,
            time: { ...timeConfig },
        }
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).not.toHaveBeenCalled()
        expect(Map_.refreshLayer).toHaveBeenCalled()
    })
})
