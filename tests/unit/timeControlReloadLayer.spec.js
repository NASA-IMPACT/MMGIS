import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
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

    // Here rather than at the end of each case: a case that fails partway
    // would otherwise leave its console spy and its fetch stub standing, and
    // every case after it would be judged against them.
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
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

    // A layer that is not a raster tile takes its substituted URL on the
    // config, because the refresh reads the layer object. Baking a failed
    // urlReplacement in there would cost the layer its `{key}` for good: the
    // service could recover and there would be nothing left to fill.
    test('keeps a urlReplacement key on the config when the service fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const configUrl = 'https://example.com/{scene}/flood.geojson'
        const layer = {
            name: 'Flood Extent',
            type: 'vector',
            url: configUrl,
            controlled: false,
            time: { ...timeConfig },
            variables: {
                urlReplacements: {
                    scene: {
                        on: 'timeChange',
                        url: 'https://example.com/scenes',
                        type: 'POST',
                        body: {},
                        return: 'scene',
                    },
                },
            },
        }
        registerDeckLayer(layer)
        // Read at call time: reloadLayer puts the config URL back before it
        // returns, so the layer object no longer carries what it was given.
        const refreshedWith = []
        Map_.refreshLayer.mockImplementation(async (layerObj) => {
            refreshedWith.push(layerObj.url)
            return true
        })

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('service down')
            })
        )
        await TimeControl.reloadLayer(layer)

        expect(refreshedWith[0]).toContain('MMGIS_UNRESOLVED')
        expect(layer.url).toBe(configUrl)

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ scene: 'S2A_202206' }),
            }))
        )
        await TimeControl.reloadLayer(layer)

        expect(refreshedWith[1]).toBe(
            'https://example.com/S2A_202206/flood.geojson'
        )
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

    // refreshLayer returns false specifically to say it had no layer to
    // refresh. Dropping that leaves the time change silently unapplied and
    // stale tiles on screen with nothing to explain them.
    test('warns by name when the engine had no layer to refresh', async () => {
        refreshLayer.mockReturnValueOnce(false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const layer = makeNO2Layer('TileLayer')
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('NO2 Monthly')
    })

    test('stays quiet when the engine refreshed the layer', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const layer = makeNO2Layer('TileLayer')
        registerDeckLayer(layer)

        await TimeControl.reloadLayer(layer)

        expect(warn).not.toHaveBeenCalled()
    })
})

/**
 * performTimeUrlReplacements fetches a value from a service and splices it
 * into the URL. Layer creation, time reload and layers:refresh all await it,
 * so it has to settle whatever the service does — a call that never settles
 * leaves every one of them waiting forever — and it has to hand back a URL
 * with no `{key}` left in it, because Leaflet's URL template throws on one.
 */
describe('TimeControl.performTimeUrlReplacements', () => {
    let TimeControl
    let warn

    beforeEach(async () => {
        vi.resetModules()
        TimeControl = (await import('../../src/essence/Basics/TimeControl_/TimeControl'))
            .default
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    const makeSceneLayer = () => ({
        name: 'Flood Extent',
        url: 'https://example.com/{scene}/{z}/{x}/{y}.png',
        time: { ...timeConfig },
        variables: {
            urlReplacements: {
                scene: {
                    on: 'timeChange',
                    url: 'https://example.com/scenes',
                    type: 'POST',
                    body: { from: '{starttime}', to: '{endtime}' },
                    return: 'scene',
                },
            },
        },
    })

    const UNRESOLVED_URL = 'https://example.com/MMGIS_UNRESOLVED/{z}/{x}/{y}.png'

    const answer = (body, ok = true) => ({ ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Internal Server Error', json: async () => body })

    test('asks the service with the layer time range and splices its answer into the URL', async () => {
        const fetch = vi.fn(async () => answer({ scene: 'S2A_202206' }))
        vi.stubGlobal('fetch', fetch)
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe('https://example.com/S2A_202206/{z}/{x}/{y}.png')
        expect(fetch.mock.calls[0][1].body).toBe('{"from":"202201","to":"202206"}')
        expect(warn).not.toHaveBeenCalled()
    })

    // vitest's own timeout is the hang detector here: a promise that never
    // settles fails this test rather than passing it vacuously.
    test('substitutes a marker and warns when the service is unreachable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('service down')
            })
        )
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe(UNRESOLVED_URL)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('Flood Extent')
    })

    test('substitutes a marker and warns when the service answers with an error status', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer({ detail: 'no such collection' }, false)))
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe(UNRESOLVED_URL)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('substitutes a marker and warns when the answer has no value to splice in', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer({ scenes: [] })))
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe(UNRESOLVED_URL)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    // The hang the deadline exists for: a server that accepts the connection
    // and then says nothing. Nothing else ends this fetch, so the abort is
    // the only thing that can settle the call — shortened here so the test
    // does not sit out the real 15 s.
    test('substitutes a marker and warns when the service never answers', async () => {
        const realTimeout = AbortSignal.timeout.bind(AbortSignal)
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
            realTimeout(10)
        )
        const fetch = vi.fn(
            (url, options) =>
                new Promise((_, reject) => {
                    options.signal.addEventListener('abort', () =>
                        reject(options.signal.reason)
                    )
                })
        )
        vi.stubGlobal('fetch', fetch)
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe(UNRESOLVED_URL)
        expect(warn).toHaveBeenCalledTimes(1)
        // Not a fetch that failed for some other reason: the request really
        // carried a signal, and that signal is what fired.
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    })

    // 0 and '' are values a service can legitimately return, so "no value"
    // has to mean absent rather than falsy.
    test('splices in a value the service returns as 0', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer({ scene: 0 })))
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe('https://example.com/0/{z}/{x}/{y}.png')
        expect(warn).not.toHaveBeenCalled()
    })

    test('substitutes a marker and warns when the answer is not JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => {
                    throw new SyntaxError('Unexpected token <')
                },
            }))
        )
        const layer = makeSceneLayer()

        const url = await TimeControl.performTimeUrlReplacements(layer.url, layer, false)

        expect(url).toBe(UNRESOLVED_URL)
        expect(warn).toHaveBeenCalledTimes(1)
    })
})
