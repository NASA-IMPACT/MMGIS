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

const updateLayer = vi.fn()
const rebuildDeckCOGLayer = vi.fn()

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({
    default: {
        engine: {
            engineType: MAP_ENGINE.DECKGL,
            updateLayer: (...args) => updateLayer(...args),
        },
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
        rebuildDeckCOGLayer: (...args) => rebuildDeckCOGLayer(...args),
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
        updateLayer.mockClear()
        rebuildDeckCOGLayer.mockClear()
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

    test.each([['tile'], ['TileLayer'], ['BitmapLayer']])(
        'substitutes {time} into the tile URL for a %s layer',
        async (type) => {
            const layer = makeNO2Layer(type)
            registerDeckLayer(layer)

            await TimeControl.reloadLayer(layer)

            expect(updateLayer).toHaveBeenCalledTimes(1)
            const [name, options] = updateLayer.mock.calls[0]
            expect(name).toBe('NO2 Monthly')
            expect(options.url).toContain('OMI_trno2_0.10x0.10_202206_Col3_V4.nc')
            expect(options.url).not.toContain('{time}')
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

            expect(updateLayer).not.toHaveBeenCalled()
            expect(Map_.refreshLayer).toHaveBeenCalled()
        }
    )

    // A colormap picked in the Layer Manager lives on the config as
    // `currentCogColormap`. A time change recompiles the URL from the config
    // alone, so the pick has to survive that recompile.
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

        expect(updateLayer).toHaveBeenCalledTimes(1)
        const [, options] = updateLayer.mock.calls[0]
        expect(options.url).toContain('colormap_name=magma')
        expect(options.url).not.toContain('viridis')
    })

    test('leaves the layer config URL unmutated so the next reload re-substitutes', async () => {
        const layer = makeNO2Layer('TileLayer')
        const originalUrl = layer.url
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(layer.url).toBe(originalUrl)
    })

    test('rebuilds a deckRaster COG layer from its time-substituted file URL', async () => {
        const layer = {
            name: 'CO2 COG',
            type: 'tile',
            url: 'COG:https://example.com/cogs/co2_{time}.tif',
            cogRendererMode: 'deckRaster',
            cogTransform: true,
            minZoom: '2',
            maxZoom: '10',
            controlled: false,
            time: { ...timeConfig },
        }
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        // The TiTiler tiles URL is meaningless to the client-side renderer —
        // a clone({url}) is silently ignored by COGLayer (it reads `geotiff`).
        // The rebuild itself is L_.rebuildDeckCOGLayer's job (the single
        // build-and-register path); TimeControl supplies the substituted URL.
        expect(updateLayer).not.toHaveBeenCalled()
        expect(rebuildDeckCOGLayer).toHaveBeenCalledTimes(1)
        const [rebuiltLayerObj, rawCogUrl] = rebuildDeckCOGLayer.mock.calls[0]
        expect(rebuiltLayerObj).toBe(layer)
        expect(rawCogUrl).toBe('https://example.com/cogs/co2_202206.tif')
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

        expect(updateLayer).not.toHaveBeenCalled()
        expect(Map_.refreshLayer).toHaveBeenCalled()
    })
})
