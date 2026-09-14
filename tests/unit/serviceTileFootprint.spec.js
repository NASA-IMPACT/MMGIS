import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Where a deck.gl tile layer's footprint comes from: the tile service's own
 * tilejson, read once per URL after the layer is already on the map.
 *
 * The module keeps a page-lifetime cache, so every spec loads it fresh through
 * `loadModule` rather than sharing one instance across the file.
 */

// Layers_ is read here for the one thing a tilejson URL must not diverge from:
// the collection name the layer's tile URLs are built with. It reaches Map_
// transitively, which pulls in JSX that Vite will not parse from a .js file.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

const TITILER = 'https://titiler.example.org'
const PGSTAC = 'https://pgstac.example.org'

const loadModule = async () => {
    vi.resetModules()
    return import('../../src/essence/Basics/Layers_/serviceTileFootprint.js')
}

/**
 * The module alongside a `Layers_` loaded from the same fresh registry, so the
 * `L_` here is the one holding *this* instance of the module. The `L_` imported
 * above holds the instance from before the first reset and would clear that one
 * instead.
 */
const loadWithLayers = async () => {
    const footprint = await loadModule()
    const { default: Layers } = await import(
        '../../src/essence/Basics/Layers_/Layers_.js'
    )
    return { ...footprint, L_: Layers }
}

/**
 * A response as the module reads one: `ok`, `status`, `statusText` and a
 * `json()` that may itself reject on a body that is not JSON.
 */
const jsonResponse = (body, { ok = true, status = 200, statusText = 'OK' } = {}) => ({
    ok,
    status,
    statusText,
    json: async () => {
        if (body instanceof Error) throw body
        return body
    },
})

/**
 * A TiTiler COG tilejson: real zooms and bounds, both read from the file.
 * TiTiler 0.22 reports the COG's own pyramid, so the floor here is a genuine
 * one — and is still the number that is never passed on.
 */
const COG_TILEJSON = {
    tilejson: '3.0.0',
    tiles: ['https://titiler.example.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}'],
    minzoom: 8,
    maxzoom: 14,
    bounds: [-8.05, 18.89, -6.99, 19.89],
}

/**
 * A titiler-pgstac collection tilejson. Its zooms are the tile matrix set's
 * own range, which is what the live service returns for every collection
 * regardless of the collection's pyramid; its bounds are the collection's
 * declared `extent.spatial.bbox`.
 *
 * Observed 2026-09-14 from openveda.cloud/api/raster (titiler-pgstac 1.8) for
 * `caldor-fire-burn-severity`.
 */
const STAC_TILEJSON = {
    tilejson: '2.2.0',
    minzoom: 0,
    maxzoom: 24,
    bounds: [
        -120.61338752166166, 38.549319926107025, -119.91919400099995,
        38.90577651328637,
    ],
}

/**
 * The same service for a collection declaring no spatial extent: the defaults
 * fill in the world box next to the matrix set's own zooms, so the document
 * says nothing at all about where the data is.
 *
 * Observed 2026-09-14 from the same service for `blizzard-era5-2m-temp`.
 */
const WORLDWIDE_STAC_TILEJSON = {
    ...STAC_TILEJSON,
    bounds: [-180.0, -90.0, 180.0, 90.0],
}

const externalServices = () => {
    window.mmgisglobal = {
        SERVER: 'node',
        options: {
            services: { titilerUrl: TITILER, titilerPgStacUrl: PGSTAC },
        },
    }
}

beforeEach(() => {
    externalServices()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete window.mmgisglobal
})

describe('tilejsonUrlFor', () => {
    test('asks TiTiler about a COG by its file URL alone', async () => {
        const { tilejsonUrlFor } = await loadModule()

        expect(
            tilejsonUrlFor({
                splitColonType: 'COG',
                sourceUrl: 'COG:https://data.example.org/dem.tif',
                cogUrl: 'https://data.example.org/dem.tif',
                layerConfig: {
                    // None of these change where the data is or how deep it
                    // goes, so none of them belong on the request.
                    cogColormap: 'viridis',
                    cogRescale: '0,100',
                    cogBands: [1],
                    cogExpression: 'b1*2',
                },
            })
        ).toBe(
            `${TITILER}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(
                'https://data.example.org/dem.tif'
            )}`
        )
    })

    test('asks titiler-pgstac about a collection by name', async () => {
        const { tilejsonUrlFor } = await loadModule()

        expect(
            tilejsonUrlFor({
                splitColonType: 'stac-collection',
                sourceUrl: 'stac-collection:caldor-fire-burn-severity?limit=10',
                layerConfig: {},
            })
        ).toBe(
            `${PGSTAC}/collections/caldor-fire-burn-severity/WebMercatorQuad/tilejson.json?assets=asset`
        )
    })

    // A titiler-url endpoint has no derivable tilejson path, a plain template
    // and a WMS service are not TiTilers at all, and a COG read client-side by
    // the deck raster layer requests no tiles for a footprint to narrow.
    test.each([
        [
            'a titiler-url source',
            {
                splitColonType: 'titiler-url',
                sourceUrl: 'titiler-url:https://tiles.example.org/x/{z}/{x}/{y}',
                layerConfig: {},
            },
        ],
        [
            'a plain {z}/{x}/{y} template',
            {
                splitColonType: undefined,
                sourceUrl: 'https://tiles.example.org/{z}/{x}/{y}.png',
                layerConfig: {},
            },
        ],
        [
            'a WMS layer',
            {
                splitColonType: undefined,
                sourceUrl: 'https://wms.example.org/geoserver/wms',
                layerConfig: { tileformat: 'wms' },
            },
        ],
        [
            'a COG in deck raster mode',
            {
                splitColonType: 'COG',
                sourceUrl: 'COG:https://data.example.org/dem.tif',
                cogUrl: 'https://data.example.org/dem.tif',
                layerConfig: { cogRendererMode: 'deckRaster' },
            },
        ],
    ])('asks nothing about %s', async (_label, source) => {
        const { tilejsonUrlFor } = await loadModule()
        expect(tilejsonUrlFor(source)).toBe(null)
    })

    // Both addresses name the collection, and a layer narrowed to a different
    // collection than it fetches tiles from would be narrowed to the wrong
    // place. A name with a further colon in it is where the two readings could
    // drift apart, so that is the one asserted.
    test('names the collection the way the layer’s tile URL does', async () => {
        const { tilejsonUrlFor } = await loadModule()
        const sourceUrl = 'stac-collection:era5:daily?datetime=2024-01-01'
        const collectionIn = (url) => url.split('/collections/')[1].split('/')[0]

        expect(
            collectionIn(
                tilejsonUrlFor({
                    splitColonType: 'stac-collection',
                    sourceUrl,
                    layerConfig: {},
                })
            )
        ).toBe(collectionIn(L_.transformStacUrl(sourceUrl, {}, 'tile')))
    })

    // deck.gl indexes WebMercator tiles only, so a footprint numbered in
    // another matrix set's levels could not be applied to the layer.
    test.each([
        ['COG', { splitColonType: 'COG', cogUrl: 'https://d.example/x.tif' }],
        [
            'stac-collection',
            {
                splitColonType: 'stac-collection',
                sourceUrl: 'stac-collection:caldor-fire-burn-severity',
            },
        ],
    ])('asks nothing about a %s layer on another tile matrix set', async (_l, source) => {
        const { tilejsonUrlFor } = await loadModule()
        expect(
            tilejsonUrlFor({
                sourceUrl: '',
                ...source,
                layerConfig: { tileMatrixSet: 'WorldCRS84Quad' },
            })
        ).toBe(null)
    })

    // A static build with nothing configured has no service to ask: the getter
    // returns null rather than a same-origin path that would 404.
    test.each([
        ['COG', { splitColonType: 'COG', cogUrl: 'https://d.example/x.tif' }],
        [
            'stac-collection',
            {
                splitColonType: 'stac-collection',
                sourceUrl: 'stac-collection:caldor-fire-burn-severity',
            },
        ],
    ])('asks nothing about a %s layer with no service configured', async (_l, source) => {
        window.mmgisglobal = { SERVER: 'static' }
        const { tilejsonUrlFor } = await loadModule()
        expect(tilejsonUrlFor({ sourceUrl: '', ...source, layerConfig: {} })).toBe(
            null
        )
    })

    // A time-templated COG names no file until its times resolve: {time}
    // compiles to nothing, and a {customtime.N} with no custom time configured
    // stays in the URL as it is. Either would spend a request on a 404 and,
    // worse, have it remembered under that URL for the life of the page.
    test.each([
        [
            'a time that compiled to nothing',
            {
                cogUrl: 'https://data.example.org/dem_.tif',
                cogUrlTemplate: 'https://data.example.org/dem_{time}.tif',
            },
        ],
        [
            'a custom time still in the URL',
            {
                cogUrl: 'https://data.example.org/dem_{customtime.0}.tif',
                cogUrlTemplate: 'https://data.example.org/dem_{customtime.0}.tif',
            },
        ],
    ])('asks nothing about a COG with %s', async (_label, urls) => {
        const { tilejsonUrlFor } = await loadModule()

        expect(
            tilejsonUrlFor({
                splitColonType: 'COG',
                sourceUrl: 'COG:https://data.example.org/dem_{time}.tif',
                ...urls,
                layerConfig: {},
            })
        ).toBe(null)
    })

    test('asks about the same COG once its time has resolved', async () => {
        const { tilejsonUrlFor } = await loadModule()

        expect(
            tilejsonUrlFor({
                splitColonType: 'COG',
                sourceUrl: 'COG:https://data.example.org/dem_{time}.tif',
                cogUrl: 'https://data.example.org/dem_202207.tif',
                cogUrlTemplate: 'https://data.example.org/dem_{time}.tif',
                layerConfig: {},
            })
        ).toContain(
            encodeURIComponent('https://data.example.org/dem_202207.tif')
        )
    })

    // A deployment that serves no /titiler proxy points the layer at someone
    // else's, and the tilejson has to be read from the same place the tiles
    // are.
    test('reads a per-layer service override', async () => {
        const { tilejsonUrlFor } = await loadModule()

        expect(
            tilejsonUrlFor({
                splitColonType: 'stac-collection',
                sourceUrl: 'stac-collection:caldor-fire-burn-severity',
                layerConfig: { titilerPgStacUrl: 'https://other.example.org/raster' },
            })
        ).toBe(
            'https://other.example.org/raster/collections/caldor-fire-burn-severity/WebMercatorQuad/tilejson.json?assets=asset'
        )
    })
})

describe('footprintFromTilejson', () => {
    test('takes a COG tilejson as an extent and a ceiling', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(footprintFromTilejson(COG_TILEJSON)).toEqual({
            extent: [-8.05, 18.89, -6.99, 19.89],
            maxZoom: 14,
        })
    })

    // The service's own floor is never passed on. deck.gl reads a minZoom
    // alongside an extent as "raise every request to this level" across that
    // whole extent, which costs far more requests at low zoom than it saves -
    // see deckGLHelpers.spec for that measured against deck.gl itself.
    test('never reports the service’s own floor', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(footprintFromTilejson(COG_TILEJSON)).not.toHaveProperty(
            'minZoom'
        )
        expect(
            footprintFromTilejson({
                minzoom: 8,
                maxzoom: 14,
                bounds: [-8.05, 18.89, -6.99, 19.89],
            })
        ).toEqual({ extent: [-8.05, 18.89, -6.99, 19.89], maxZoom: 14 })
    })

    // titiler-pgstac numbers the matrix set, not the collection, so 0..24 says
    // nothing about the data and must not displace the configured ceiling.
    test('takes the matrix set’s own range as no zooms reported', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(footprintFromTilejson(STAC_TILEJSON)).toEqual({
            extent: STAC_TILEJSON.bounds,
        })
    })

    // A collection declaring the world as its extent.spatial.bbox is telling
    // us nothing, and an extent that excludes no tile is worth no prop.
    test('takes world-covering bounds as no bounds reported', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(footprintFromTilejson(WORLDWIDE_STAC_TILEJSON)).toEqual({})
    })

    // TiTiler reports these for a COG that reaches the antimeridian and the
    // Mercator latitude limit; refusing them would cost a real footprint.
    test('clamps bounds that overshoot the degree limits', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(
            footprintFromTilejson({
                minzoom: 0,
                maxzoom: 5,
                bounds: [-180.0000001, -85.0511287798066, 180.0000001, 85.0511287798066],
            })
        ).toEqual({
            extent: [-180, -85.0511287798066, 180, 85.0511287798066],
            maxZoom: 5,
        })
    })

    // Clamping happens before the world is recognised, so bounds reported a
    // hair outside the limits are still the world box that says nothing about
    // where the data is.
    test('takes bounds a hair past the world as no bounds reported', async () => {
        const { footprintFromTilejson } = await loadModule()

        expect(
            footprintFromTilejson({
                minzoom: 0,
                maxzoom: 5,
                bounds: [-180.0000001, -90.0000001, 180.0000001, 90.0000001],
            })
        ).toEqual({ maxZoom: 5 })
    })

    // Clamping cannot fix an axis that runs backwards or a corner that is not
    // a number, and an extent deck.gl cannot use is worse than none.
    test.each([
        ['a transposed longitude axis', [10, 0, -10, 5]],
        ['a transposed latitude axis', [-10, 5, 10, 0]],
        ['a non-numeric corner', [-10, 'south', 10, 5]],
        ['three numbers', [-10, 0, 10]],
        ['no bounds at all', undefined],
    ])('withholds an extent given %s', async (_label, bounds) => {
        const { footprintFromTilejson } = await loadModule()

        expect(
            footprintFromTilejson({ minzoom: 8, maxzoom: 14, bounds })
        ).toEqual({ maxZoom: 14 })
    })

    // A tilejson missing one of the pair is not reporting a range. A field
    // written null is missing too, not the zero Number() makes of it - and a
    // zero floor next to a real ceiling is the pgstac default pair.
    test.each([
        ['only a minzoom', { minzoom: 8 }],
        ['only a maxzoom', { maxzoom: 14 }],
        ['a null minzoom', { minzoom: null, maxzoom: 14 }],
        ['a null maxzoom', { minzoom: 8, maxzoom: null }],
        ['neither', {}],
    ])('withholds a level range given %s', async (_label, zooms) => {
        const { footprintFromTilejson } = await loadModule()

        expect(
            footprintFromTilejson({ ...zooms, bounds: [-10, 0, 10, 5] })
        ).toEqual({ extent: [-10, 0, 10, 5] })
    })

    test.each([
        ['null', null],
        ['a string', 'not a tilejson'],
    ])('refuses %s as a tilejson', async (_label, body) => {
        const { footprintFromTilejson } = await loadModule()
        expect(footprintFromTilejson(body)).toBe(null)
    })
})

describe('startServiceTileFootprint', () => {
    const COG_SOURCE = {
        splitColonType: 'COG',
        sourceUrl: 'COG:https://data.example.org/dem.tif',
        cogUrl: 'https://data.example.org/dem.tif',
        layerConfig: {},
    }
    const STAC_SOURCE = {
        splitColonType: 'stac-collection',
        sourceUrl: 'stac-collection:caldor-fire-burn-severity',
        layerConfig: {},
    }

    /** The same layer after a tile-level switch: another COG, another answer. */
    const REBUILT_COG_SOURCE = {
        splitColonType: 'COG',
        sourceUrl: 'COG:https://data.example.org/dem-detail.tif',
        cogUrl: 'https://data.example.org/dem-detail.tif',
        layerConfig: {},
    }
    const REBUILT_COG_TILEJSON = {
        minzoom: 2,
        maxzoom: 9,
        bounds: [10, 0, 12, 2],
    }

    /**
     * An engine as the apply asks about one. `holdsLayer` is the question, not
     * `hasLayer`: the engine holds every layer from creation and draws the ones
     * the mission starts on, so a hidden layer is there to be narrowed. Both
     * are stubbed so that asking the wrong one shows up as a layer left
     * unnarrowed rather than as a missing method.
     *
     * @param {object} [held] - Layer name to whether the engine draws it.
     *   Absent from the map entirely is a name that is not a key.
     */
    const engineSpy = (held = null) => ({
        holdsLayer: (name) => (held == null ? true : name in held),
        hasLayer: (name) => (held == null ? true : held[name] === true),
        updateLayer: vi.fn(),
    })

    test('narrows a COG layer to what TiTiler reports', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(COG_TILEJSON))
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true)

        expect(engine.updateLayer).toHaveBeenCalledWith('Elevation', {
            tileFootprint: {
                extent: [-8.05, 18.89, -6.99, 19.89],
                maxZoom: 14,
            },
        })
    })

    // The configured maxNativeZoom / maxZoom ceiling the layer was built with
    // survives, because pgstac reported the matrix set's range, not the
    // collection's.
    test('narrows a STAC layer to its extent alone', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(STAC_TILEJSON)))
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(
            engine,
            'Burn severity',
            STAC_SOURCE,
            true
        )

        expect(engine.updateLayer).toHaveBeenCalledWith('Burn severity', {
            tileFootprint: { extent: STAC_TILEJSON.bounds },
        })
    })

    test('leaves the layer alone when the service reports nothing usable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(WORLDWIDE_STAC_TILEJSON))
        )
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(engine, 'Worldwide', STAC_SOURCE, true)

        expect(engine.updateLayer).not.toHaveBeenCalled()
    })

    test('makes no request for a source with no tilejson to read', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(
            engine,
            'Raw',
            {
                splitColonType: 'titiler-url',
                sourceUrl: 'titiler-url:https://tiles.example.org/{z}/{x}/{y}',
                layerConfig: {},
            },
            true
        )

        expect(fetchMock).not.toHaveBeenCalled()
        expect(engine.updateLayer).not.toHaveBeenCalled()
    })

    // Two layers over one COG, or the rebuild a tile-level switch triggers,
    // resolve the same tilejson URL and must not each pay for it.
    test('reads one tilejson URL once for every layer that needs it', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(COG_TILEJSON))
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()

        await Promise.all([
            startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true),
            startServiceTileFootprint(engine, 'Slope', COG_SOURCE, true),
        ])
        await startServiceTileFootprint(engine, 'Aspect', COG_SOURCE, true)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(engine.updateLayer).toHaveBeenCalledTimes(3)
    })

    // A mission with a layer on an unreachable service must not sit on an open
    // request for the life of the page.
    test('carries the 10 s abort timeout on the request', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(COG_TILEJSON))
        vi.stubGlobal('fetch', fetchMock)
        const timeout = vi.spyOn(AbortSignal, 'timeout')
        const { startServiceTileFootprint } = await loadModule()

        await startServiceTileFootprint(
            engineSpy(),
            'Elevation',
            COG_SOURCE,
            true
        )

        expect(timeout).toHaveBeenCalledWith(10000)
        const [, init] = fetchMock.mock.calls[0]
        expect(init.signal).toBe(timeout.mock.results[0].value)
    })

    // The engine holds a layer the mission starts switched off from the moment
    // it is built, hidden, and shows it on the first toggle. Narrowing only
    // what is drawn would leave every off layer to ask for the whole world the
    // moment it is switched on - and never ask again, since the answer is
    // remembered settled.
    test('narrows a layer the engine holds hidden', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy({ Elevation: false })

        await startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true)

        expect(engine.updateLayer).toHaveBeenCalledWith('Elevation', {
            tileFootprint: expect.objectContaining({
                extent: [-8.05, 18.89, -6.99, 19.89],
            }),
        })
    })

    // The reply outlives the build that asked for it: the layer may have been
    // removed, or the map swapped to the other engine, by the time it lands.
    test('leaves an engine that does not hold the layer alone', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy({ SomethingElse: true })

        await expect(
            startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true)
        ).resolves.toBeUndefined()

        expect(engine.updateLayer).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
    })

    // Nothing awaits the call, so a rejection would surface as an unhandled
    // one. An engine swapped between the build and the reply is the way that
    // happens: the Leaflet adapter throws on an id it does not hold.
    test('never rejects when the engine refuses the update', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { startServiceTileFootprint } = await loadModule()
        const engine = {
            holdsLayer: () => true,
            updateLayer: () => {
                throw new Error('no layer found with id "Elevation"')
            },
        }

        await expect(
            startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true)
        ).resolves.toBeUndefined()

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('Elevation')
    })

    // A tile-level switch rebuilds the layer unbounded. A footprint read for
    // the level it used to be on describes data this layer no longer draws,
    // and zoom-to-layer would still be answering with it.
    test('drops the footprint it had when the rebuilt layer has none to read', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()

        await startServiceTileFootprint(
            engineSpy(),
            'Elevation',
            COG_SOURCE,
            true
        )
        expect(serviceTileFootprintFor('Elevation')).toBeDefined()

        await startServiceTileFootprint(
            engineSpy(),
            'Elevation',
            {
                splitColonType: 'titiler-url',
                sourceUrl: 'titiler-url:https://tiles.example.org/{z}/{x}/{y}',
                layerConfig: {},
            },
            true
        )

        expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
    })

    // The rebuild that leaves a layer with no service at all - the map swapped
    // to Leaflet, the layer retyped - reaches the same call with nothing to
    // ask, and the drop has to happen there too.
    test('drops the footprint it had when the rebuild has no source', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()

        await startServiceTileFootprint(
            engineSpy(),
            'Elevation',
            COG_SOURCE,
            true
        )
        expect(serviceTileFootprintFor('Elevation')).toBeDefined()

        await startServiceTileFootprint(
            engineSpy(),
            'Elevation',
            undefined,
            true
        )

        expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
    })

    // A Leaflet build is the everyday case of that: `Map_.makeTileLayer`'s
    // Leaflet tail hands back no footprint source at all, because the layer
    // takes its bounds from the config box at construction. The call still
    // happens, and must cost nothing.
    test('asks a Leaflet build’s service nothing, since it hands back no source', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(engine, 'Elevation', undefined, true)

        expect(fetchMock).not.toHaveBeenCalled()
        expect(engine.updateLayer).not.toHaveBeenCalled()
        expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
    })

    // The Animation tool builds an offscreen map of its own, rebuilding every
    // layer under the same name into its own registry. The engine here is
    // always the main map's, so one of those builds describes a layer it is
    // not holding and has nothing to say about it.
    test('keeps the main map’s footprint when another map rebuilds the layer', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(COG_TILEJSON))
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()
        const engine = engineSpy()

        await startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, true)
        await startServiceTileFootprint(engine, 'Elevation', undefined, false)

        expect(serviceTileFootprintFor('Elevation')).toEqual({
            extent: [-8.05, 18.89, -6.99, 19.89],
            maxZoom: 14,
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(engine.updateLayer).toHaveBeenCalledTimes(1)
    })

    // The build token is how a read knows it has been superseded, so a build
    // for another map taking it over would leave the main map's read with
    // nothing to come back to.
    test('leaves a read in flight when another map rebuilds the layer', async () => {
        const pending = []
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise((resolve) => pending.push(resolve)))
        )
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()
        const engine = engineSpy()

        const read = startServiceTileFootprint(
            engine,
            'Elevation',
            COG_SOURCE,
            true
        )
        await startServiceTileFootprint(engine, 'Elevation', COG_SOURCE, false)

        pending[0](jsonResponse(COG_TILEJSON))
        await read

        expect(engine.updateLayer).toHaveBeenCalledTimes(1)
        expect(serviceTileFootprintFor('Elevation')).toBeDefined()
    })

    // Deriving the URL reads the deck-raster rule and resolves the service
    // through ServiceUrls, and a config either of them chokes on must not
    // become an unhandled rejection on a call nothing awaits.
    test('never rejects when the tilejson URL cannot be derived', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { startServiceTileFootprint } = await loadModule()

        await expect(
            startServiceTileFootprint(
                engineSpy(),
                'Elevation',
                // A per-layer TiTiler override written as a number, which
                // ServiceUrls tries to trim a trailing slash from.
                { ...COG_SOURCE, layerConfig: { titilerUrl: 42 } },
                true
            )
        ).resolves.toBeUndefined()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('Elevation')
    })

    // Zoom-to-layer reads what is remembered here, so remembering a footprint
    // for a layer the engine turned out not to hold would leave it flying to
    // an extent nothing on the map has.
    test('remembers nothing for a layer the engine does not hold', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()

        await startServiceTileFootprint(
            engineSpy({ SomethingElse: true }),
            'Elevation',
            COG_SOURCE,
            true
        )

        expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
    })

    // A layer rebuilt while its first read is still open - a tile-level switch
    // during a slow tilejson - has two reads open on two URLs, and they can
    // settle in either order. The build that owns the layer now is the one
    // whose answer counts, whenever it happens to arrive.
    test('drops a read the rebuild after it has already superseded', async () => {
        const pending = []
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (url) => new Promise((resolve) => pending.push({ url, resolve }))
            )
        )
        const { startServiceTileFootprint, serviceTileFootprintFor } =
            await loadModule()
        const engine = engineSpy()

        const first = startServiceTileFootprint(
            engine,
            'Elevation',
            COG_SOURCE,
            true
        )
        const second = startServiceTileFootprint(
            engine,
            'Elevation',
            REBUILT_COG_SOURCE,
            true
        )
        expect(pending).toHaveLength(2)

        // The rebuild's read answers first, the read it replaced answers after.
        pending[1].resolve(jsonResponse(REBUILT_COG_TILEJSON))
        await second
        pending[0].resolve(jsonResponse(COG_TILEJSON))
        await first

        expect(engine.updateLayer).toHaveBeenCalledTimes(1)
        expect(engine.updateLayer).toHaveBeenCalledWith('Elevation', {
            tileFootprint: { extent: [10, 0, 12, 2], maxZoom: 9 },
        })
        expect(serviceTileFootprintFor('Elevation')).toEqual({
            extent: [10, 0, 12, 2],
            maxZoom: 9,
        })
    })

    // A time-templated COG is built before its times resolve, and the URL it
    // is built with names no file. Asking would 404, and the failure would be
    // remembered under that URL for the page - leaving the layer unnarrowed
    // for good once the real time arrives.
    test('asks nothing until a time-templated COG’s times resolve', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(COG_TILEJSON))
        vi.stubGlobal('fetch', fetchMock)
        const { startServiceTileFootprint } = await loadModule()
        const engine = engineSpy()
        const template = 'https://data.example.org/dem_{time}.tif'

        await startServiceTileFootprint(
            engine,
            'Elevation',
            {
                splitColonType: 'COG',
                sourceUrl: `COG:${template}`,
                cogUrl: 'https://data.example.org/dem_.tif',
                cogUrlTemplate: template,
                layerConfig: {},
            },
            true
        )

        expect(fetchMock).not.toHaveBeenCalled()
        expect(engine.updateLayer).not.toHaveBeenCalled()

        await startServiceTileFootprint(
            engine,
            'Elevation',
            {
                splitColonType: 'COG',
                sourceUrl: `COG:${template}`,
                cogUrl: 'https://data.example.org/dem_202207.tif',
                cogUrlTemplate: template,
                layerConfig: {},
            },
            true
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(engine.updateLayer).toHaveBeenCalledTimes(1)
    })

    describe('when the request fails', () => {
        const failures = [
            ['a non-2xx status', async () => jsonResponse(null, { ok: false, status: 404, statusText: 'Not Found' })],
            [
                'a network error',
                async () => {
                    throw new TypeError('Failed to fetch')
                },
            ],
            [
                'a timeout',
                async () => {
                    throw Object.assign(new Error('The operation was aborted due to timeout'), {
                        name: 'TimeoutError',
                    })
                },
            ],
            ['an unusable body', async () => jsonResponse(new SyntaxError('Unexpected token <'))],
            ['a body that is not a tilejson', async () => jsonResponse('<html></html>')],
        ]

        test.each(failures)('leaves the layer as built given %s', async (_label, respond) => {
            vi.stubGlobal('fetch', vi.fn(respond))
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const { startServiceTileFootprint } = await loadModule()
            const engine = engineSpy()

            await startServiceTileFootprint(
                engine,
                'Elevation',
                COG_SOURCE,
                true
            )

            expect(engine.updateLayer).not.toHaveBeenCalled()
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('Elevation')
        })

        // A service that just failed is not asked again on the next layer over
        // the same COG, nor on the rebuild a tile-level switch triggers. The
        // remembered failure is still each layer's own news, though: warning
        // once in the name of whichever layer asked first leaves every layer
        // after it silently unnarrowed.
        test('asks the same URL once and tells every layer that reuses it', async () => {
            const fetchMock = vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
            vi.stubGlobal('fetch', fetchMock)
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const { startServiceTileFootprint } = await loadModule()

            await startServiceTileFootprint(
                engineSpy(),
                'Elevation',
                COG_SOURCE,
                true
            )
            await startServiceTileFootprint(
                engineSpy(),
                'Slope',
                COG_SOURCE,
                true
            )

            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(warn).toHaveBeenCalledTimes(2)
            expect(warn.mock.calls[0][0]).toContain('Elevation')
            expect(warn.mock.calls[1][0]).toContain('Slope')
            // Each still naming what went wrong, not just which layer.
            warn.mock.calls.forEach(([message]) =>
                expect(message).toContain('Failed to fetch')
            )
        })
    })

    describe('forgetServiceTileFootprint', () => {
        // Footprints are remembered outside L_.layers, keyed by layer name and
        // pruned by nothing else, so a layer taken off the map would leave one
        // behind for the life of the page.
        test('drops what a removed layer had been narrowed to', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
            const {
                startServiceTileFootprint,
                serviceTileFootprintFor,
                forgetServiceTileFootprint,
            } = await loadModule()

            await startServiceTileFootprint(
                engineSpy(),
                'Elevation',
                COG_SOURCE,
                true
            )
            expect(serviceTileFootprintFor('Elevation')).toBeDefined()

            forgetServiceTileFootprint('Elevation')

            expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
        })

        // A read open when the layer is removed has no layer left to narrow,
        // and the name may be back on something else by the time it lands.
        test('discards a read still in flight for the removed layer', async () => {
            const pending = []
            vi.stubGlobal(
                'fetch',
                vi.fn(() => new Promise((resolve) => pending.push(resolve)))
            )
            const {
                startServiceTileFootprint,
                serviceTileFootprintFor,
                forgetServiceTileFootprint,
            } = await loadModule()
            const engine = engineSpy()

            const read = startServiceTileFootprint(
                engine,
                'Elevation',
                COG_SOURCE,
                true
            )
            forgetServiceTileFootprint('Elevation')
            pending[0](jsonResponse(COG_TILEJSON))
            await read

            expect(engine.updateLayer).not.toHaveBeenCalled()
            expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
        })
    })

    describe('forgetAllServiceTileFootprints', () => {
        // A mission swap replaces L_.layers wholesale rather than removing its
        // layers one at a time, so nothing hears about any of them the way a
        // single removal is heard about. Two missions routinely name different
        // layers the same thing, and the surviving footprint would be answered
        // to zoom-to-layer for whichever layer inherits the name.
        test('drops every layer’s footprint when the mission is cleared', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(COG_TILEJSON)))
            const { startServiceTileFootprint, serviceTileFootprintFor, L_ } =
                await loadWithLayers()

            await startServiceTileFootprint(
                engineSpy(),
                'Elevation',
                COG_SOURCE,
                true
            )
            await startServiceTileFootprint(
                engineSpy(),
                'Slope',
                COG_SOURCE,
                true
            )
            expect(serviceTileFootprintFor('Elevation')).toBeDefined()
            expect(serviceTileFootprintFor('Slope')).toBeDefined()

            L_.clear()

            expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
            expect(serviceTileFootprintFor('Slope')).toBeUndefined()
        })

        // The reads open when the mission is swapped have no layer left to
        // narrow either, and the build tokens they are checked against go with
        // the footprints.
        test('discards the reads still in flight when the mission is cleared', async () => {
            const pending = []
            vi.stubGlobal(
                'fetch',
                vi.fn(() => new Promise((resolve) => pending.push(resolve)))
            )
            const { startServiceTileFootprint, serviceTileFootprintFor, L_ } =
                await loadWithLayers()
            const engine = engineSpy()

            const read = startServiceTileFootprint(
                engine,
                'Elevation',
                COG_SOURCE,
                true
            )
            L_.clear()
            pending[0](jsonResponse(COG_TILEJSON))
            await read

            expect(engine.updateLayer).not.toHaveBeenCalled()
            expect(serviceTileFootprintFor('Elevation')).toBeUndefined()
        })
    })
})
