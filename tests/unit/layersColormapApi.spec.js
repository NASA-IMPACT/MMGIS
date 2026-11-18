import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively; the providers under test only read
// `L_.Map_`, which fina() assigns, so a bare stub keeps the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_.js')
const { clearColormapCache } = await import(
    '../../src/essence/Basics/Colormaps/titilerColormaps'
)
const { registerColormapApplier } = await import(
    '../../src/essence/Basics/Layers_/layerColormapApi'
)
const { applyCogFieldsToUrl } = await import(
    '../../src/essence/Basics/Layers_/tileUrlUtils'
)
const { getStandardColormapCss, STANDARD_COLORMAP_NAMES } = await import(
    '../../src/essence/Basics/Colormaps/standardColormaps'
)
const { colormapResponseToTable, colormapTableToCss } = await import(
    '../../src/essence/Basics/Colormaps/colormapTable'
)

/**
 * One runtime colormap API for every kind of colormap layer:
 *
 * - `layers:getColormapCapabilities` — whether a layer has a colormap, can
 *   change it where it is painted now, which ramps it can use and which of
 *   them reverse;
 * - `layers:getColormapColors` — a ramp's colours as the layer paints them;
 * - `layers:setColormap` — the one way to change ramp, direction and range.
 *
 * Plugins never write a layer's colormap fields themselves.
 */

const SERVICE = 'https://eic.test/api/titiler-multidim'

const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

const TILE = 'Ozone_0123456789abcdef'
const DECK = 'PM25_fedcba9876543210'
const PLAIN = 'Basemap_aaaaaaaaaaaaaaaa'
const IMAGE = 'Hillshade_bbbbbbbbbbbbbbbb'
const VECTOR = 'AQS_cccccccccccccccc'

const tileLayer = (fields = {}) => ({
    name: TILE,
    type: 'tile',
    url: 'titiler-url:https://example.com/cog/tiles/{z}/{x}/{y}.png?url=s3://b/o3.tif',
    cogTransform: true,
    cogColormap: 'viridis',
    cogMin: 0,
    cogMax: 80,
    ...fields,
})

const deckLayer = (fields = {}) => ({
    name: DECK,
    type: 'tile',
    url: 'COG:https://data.test/pm25.tif',
    cogTransform: true,
    cogRendererMode: 'deckRaster',
    cogColormap: 'naqfc_pm25',
    cogMin: 0,
    cogMax: 50,
    ...fields,
})

const vectorLayer = () => ({
    name: VECTOR,
    type: 'vector',
    style: {
        colorBy: {
            mode: 'colormap',
            property: 'sample_measurement',
            colormap: 'jet',
            min: 1,
            max: 18,
            unit: 'µg/m³',
        },
    },
})

let providers
let refreshLayer
let emitted
let engineType

const withLayers = (layers, { service = null } = {}) => {
    window.mmgisglobal = { options: service ? { services: { titilerUrl: service } } : {} }
    L_.layers.data = Object.fromEntries(layers.map((l) => [l.name, l]))
    L_.layers.nameToUUID = Object.fromEntries(layers.map((l) => [l.name, [l.name]]))
    layers.forEach((l) => {
        L_.layers.on[l.name] = true
    })
    providers = {}
    emitted = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (name, payload) => emitted.push([name, payload]),
    }
    refreshLayer = vi.fn(() => true)
    L_.fina(
        null,
        { engine: { engineType, refreshLayer } },
        null,
        null,
        null,
        { performTimeUrlReplacements: async (url) => url }
    )
}

const stubService = (responses) => {
    const fetch = vi.fn(async (url) => {
        const name = decodeURIComponent(url.slice(`${SERVICE}/colorMaps`.length).replace(/^\//, ''))
        const body = responses[name]
        return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
}

const EIC = () => ({
    '': fixture('eic/colorMaps.json'),
    viridis: fixture('eic/viridis.json'),
    naqfc_pm25: fixture('eic/naqfc_pm25.json'),
})

beforeEach(() => {
    engineType = MAP_ENGINE.DECKGL
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('layers:getColormapCapabilities', () => {
    test("reports a raster's setting, ramps and reversibility from its service", async () => {
        stubService(EIC())
        withLayers([tileLayer()], { service: SERVICE })

        const caps = await providers['layers:getColormapCapabilities'](TILE)

        expect(caps).toMatchObject({
            hasColormap: true,
            canChangeColormap: true,
            reversible: true,
            sourceId: `service:${SERVICE}`,
            colormap: { name: 'viridis', reversed: false, min: 0, max: 80, mode: 'continuous' },
        })
        const ramps = Object.fromEntries(caps.ramps.map((r) => [r.name, r.reversible]))
        expect(ramps.viridis).toBe(true)
        expect(ramps.naqfc_pm25).toBe(false)
    })

    test('a ramp the service publishes without `_r` is not reversible', async () => {
        stubService(EIC())
        withLayers([deckLayer()], { service: SERVICE })

        const caps = await providers['layers:getColormapCapabilities'](DECK)
        expect(caps.reversible).toBe(false)
    })

    // The same config answers differently by engine: a client-side COG layer
    // repaints itself, while on Leaflet its plain COG: source carries no
    // colormap to recompile.
    test('whether a raster can change its colormap depends on the engine', async () => {
        withLayers([deckLayer()])
        expect((await providers['layers:getColormapCapabilities'](DECK)).canChangeColormap).toBe(
            true
        )

        engineType = MAP_ENGINE.LEAFLET
        withLayers([deckLayer({ url: 'https://tiles.test/{z}/{x}/{y}.png' })])
        expect((await providers['layers:getColormapCapabilities'](DECK)).canChangeColormap).toBe(
            false
        )
    })

    test('an image layer has a colormap it cannot change', async () => {
        withLayers([tileLayer({ name: IMAGE, type: 'image' })])
        expect(await providers['layers:getColormapCapabilities'](IMAGE)).toMatchObject({
            hasColormap: true,
            canChangeColormap: false,
        })
    })

    test('with no service, lists the bundled ramps and asks nothing', async () => {
        const fetch = stubService({})
        withLayers([tileLayer()])

        const caps = await providers['layers:getColormapCapabilities'](TILE)
        expect(caps.sourceId).toBe('bundle')
        expect(caps.ramps.map((r) => r.name)).toEqual(STANDARD_COLORMAP_NAMES)
        expect(caps.reversible).toBe(true)
        expect(fetch).not.toHaveBeenCalled()
    })

    test('an unreachable service never empties the list', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
        )
        withLayers([tileLayer()], { service: SERVICE })
        const caps = await providers['layers:getColormapCapabilities'](TILE)
        expect(caps.ramps.length).toBe(STANDARD_COLORMAP_NAMES.length)
    })

    test('a categorical setting offers no reversing', async () => {
        withLayers([tileLayer({ cogColormapMode: 'categorical' })])
        const caps = await providers['layers:getColormapCapabilities'](TILE)
        expect(caps.reversible).toBe(false)
        expect(caps.ramps.every((r) => r.reversible === false)).toBe(true)
    })

    // Vector colormap layers are reported, and say they cannot change their
    // colormap until an applier for them is registered.
    test('a vector colormap layer has a colormap it cannot change yet', async () => {
        withLayers([vectorLayer()])
        expect(await providers['layers:getColormapCapabilities'](VECTOR)).toMatchObject({
            hasColormap: true,
            canChangeColormap: false,
            colormap: { name: 'jet', min: 1, max: 18, unit: 'µg/m³' },
        })
    })

    test('a layer without a colormap, and the whole map at once', async () => {
        withLayers([tileLayer(), { name: PLAIN, type: 'tile', url: 'x/{z}/{x}/{y}.png' }])

        const all = await providers['layers:getColormapCapabilities']()
        expect(Object.keys(all)).toEqual([TILE, PLAIN])
        expect(all[PLAIN]).toEqual({
            hasColormap: false,
            canChangeColormap: false,
            colormap: null,
            reversible: false,
            ramps: null,
            sourceId: null,
        })
        expect(await providers['layers:getColormapCapabilities']('nope')).toBeNull()
    })

    // The legacy query keeps answering as it did.
    test('layers:getCogCapabilities still answers', () => {
        withLayers([deckLayer()])
        expect(providers['layers:getCogCapabilities'](DECK)).toEqual({
            hasColormap: true,
            canChangeColormap: true,
        })
    })
})

describe('layers:getColormapColors', () => {
    // A picker swatch asks core for a ramp's colours, so it shows what the
    // map paints: from the same source, the service's own `_r` included.
    test("gives a ramp's colours from the layer's sources", async () => {
        stubService(EIC())
        withLayers([deckLayer()], { service: SERVICE })

        expect(
            await providers['layers:getColormapColors']({ layerUUID: DECK, name: 'naqfc_pm25' })
        ).toEqual(
            colormapTableToCss(
                colormapResponseToTable('naqfc_pm25', fixture('eic/naqfc_pm25.json'))
            )
        )
        // No ramp named: the layer's own.
        expect(await providers['layers:getColormapColors']({ layerUUID: DECK })).toHaveLength(256)
    })

    test("no ramp named is the layer's own ramp, in its own direction", async () => {
        withLayers([tileLayer({ cogColormap: 'magma_r' })])
        expect(
            await providers['layers:getColormapColors']({
                layerUUID: TILE,
                name: '',
                reversed: false,
            })
        ).toEqual(getStandardColormapCss('magma', true))
    })

    test('reverses as asked, and is null for a layer with no colormap', async () => {
        withLayers([tileLayer(), { name: PLAIN, type: 'tile' }])
        expect(
            await providers['layers:getColormapColors']({
                layerUUID: TILE,
                name: 'magma',
                reversed: true,
            })
        ).toEqual(getStandardColormapCss('magma', true))
        expect(await providers['layers:getColormapColors']({ layerUUID: PLAIN })).toBeNull()
    })
})

describe('layers:setColormap', () => {
    // A range change does not depend on the ramp list, so a layer whose ramp
    // the fallback list does not hold can still be rescaled.
    test('rescales a layer whose ramp its sources cannot list right now', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
        )
        withLayers([deckLayer()], { service: SERVICE })

        expect(
            await providers['layers:setColormap']({ layerUUID: DECK, min: 1, max: 40 })
        ).toBe(true)
        expect(L_.layers.data[DECK]).toMatchObject({
            currentCogColormap: 'naqfc_pm25',
            currentCogMin: 1,
            currentCogMax: 40,
        })
    })

    test('refuses a range whose min is not below its max', async () => {
        withLayers([tileLayer()])
        // Merged with the current 0..80.
        expect(await providers['layers:setColormap']({ layerUUID: TILE, min: 90 })).toBe(false)
        expect(await providers['layers:setColormap']({ layerUUID: TILE, max: 0 })).toBe(false)
        expect(
            await providers['layers:setColormap']({ layerUUID: TILE, min: 5, max: 5 })
        ).toBe(false)
        expect(refreshLayer).not.toHaveBeenCalled()
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('must be below'))

        expect(
            await providers['layers:setColormap']({ layerUUID: TILE, min: -1, max: 0 })
        ).toBe(true)
        expect(await providers['layers:setColormap']({ layerUUID: TILE, min: 0, max: 1 })).toBe(
            true
        )
        expect(L_.layers.data[TILE]).toMatchObject({ currentCogMin: 0, currentCogMax: 1 })
    })

    test('a ramp name without `reversed` replaces a reversed ramp with a forward one', async () => {
        withLayers([tileLayer({ cogColormap: 'viridis_r' })])
        expect(await providers['layers:setColormap']({ layerUUID: TILE, name: 'magma' })).toBe(
            true
        )
        expect(L_.layers.data[TILE].currentCogColormap).toBe('magma')
    })

    // A service may list `foo_r` with no `foo`: that is a ramp of its own,
    // chosen forward and never reversible.
    describe('a listed `_r` ramp with no forward form', () => {
        const withStandalone = () => {
            stubService({ '': { colorMaps: ['viridis', 'viridis_r', 'foo_r'] } })
            withLayers([tileLayer({ titilerUrl: SERVICE })], { service: SERVICE })
        }

        test('is selected as itself, forward', async () => {
            withStandalone()
            expect(
                await providers['layers:setColormap']({ layerUUID: TILE, name: 'foo_r' })
            ).toBe(true)
            expect(L_.layers.data[TILE].currentCogColormap).toBe('foo_r')

            const caps = await providers['layers:getColormapCapabilities'](TILE)
            expect(caps.colormap).toMatchObject({ name: 'foo_r', reversed: false })
            expect(caps.reversible).toBe(false)
        })

        test('cannot be reversed', async () => {
            withStandalone()
            await providers['layers:setColormap']({ layerUUID: TILE, name: 'foo_r' })
            expect(
                await providers['layers:setColormap']({ layerUUID: TILE, reversed: true })
            ).toBe(false)
            expect(
                await providers['layers:setColormap']({
                    layerUUID: TILE,
                    name: 'foo_r',
                    reversed: true,
                })
            ).toBe(false)
            expect(L_.layers.data[TILE].currentCogColormap).toBe('foo_r')
        })
    })

    test('a categorical ramp is written forward, as the legend draws it', async () => {
        withLayers([tileLayer({ cogColormap: 'tab10', cogColormapMode: 'categorical' })])
        expect(
            await providers['layers:setColormap']({ layerUUID: TILE, name: 'set1_r' })
        ).toBe(false)
        expect(await providers['layers:setColormap']({ layerUUID: TILE, name: 'set1' })).toBe(
            true
        )
        expect(L_.layers.data[TILE].currentCogColormap).toBe('set1')
    })

    // A layer that cannot be redrawn now (one switched off) keeps the setting
    // for its next draw, so the change still counts as applied.
    test('answers true and keeps the setting when the layer could not be redrawn', async () => {
        withLayers([tileLayer()])
        refreshLayer.mockReturnValue(false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(await providers['layers:setColormap']({ layerUUID: TILE, name: 'magma' })).toBe(
            true
        )
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
        expect(L_.layers.data[TILE].currentCogColormap).toBe('magma')
    })

    // The tile-URL path: the runtime overrides are written, and the layer is
    // redrawn with a tile URL recompiled from them — the same URL the
    // raster-specific path produced.
    test('changes a tile layer’s ramp, direction and range through its tile URL', async () => {
        withLayers([tileLayer()])

        const ok = await providers['layers:setColormap']({
            layerUUID: TILE,
            name: 'magma',
            reversed: true,
            min: 5,
            max: 60,
        })

        expect(ok).toBe(true)
        const layer = L_.layers.data[TILE]
        expect(layer).toMatchObject({
            currentCogColormap: 'magma_r',
            currentCogMin: 5,
            currentCogMax: 60,
            cogColormap: 'viridis',
        })
        expect(refreshLayer).toHaveBeenCalledTimes(1)
        const [id, ctx] = refreshLayer.mock.calls[0]
        expect(id).toBe(TILE)
        expect(ctx.tileOptions).toMatchObject({
            currentCogColormap: 'magma_r',
            currentCogMin: 5,
            currentCogMax: 60,
        })
        expect(applyCogFieldsToUrl('https://t/{z}?url=a', ctx.tileOptions)).toBe(
            'https://t/{z}?url=a&colormap_name=magma_r&rescale=5%2C60'
        )
        expect(emitted).toContainEqual([
            'layers:configChanged',
            { layerName: TILE, keys: ['currentCogColormap', 'currentCogMin', 'currentCogMax'] },
        ])
        expect(emitted).toContainEqual([
            'layer:colormapChange',
            {
                layerName: TILE,
                colormap: expect.objectContaining({ name: 'magma', reversed: true, min: 5, max: 60 }),
            },
        ])
    })

    // The client-side COG path: the same write, and the engine rebuilds the
    // layer through its registered refresher (see deckCOGRefresher).
    test('changes a client-side COG layer through an engine rebuild', async () => {
        stubService(EIC())
        withLayers([deckLayer()], { service: SERVICE })

        expect(
            await providers['layers:setColormap']({ layerUUID: DECK, name: 'viridis' })
        ).toBe(true)
        expect(L_.layers.data[DECK].currentCogColormap).toBe('viridis')
        expect(refreshLayer).toHaveBeenCalledWith(DECK, expect.anything())
    })

    test('changes only what it is given', async () => {
        withLayers([tileLayer({ cogColormap: 'plasma_r' })])

        expect(await providers['layers:setColormap']({ layerUUID: TILE, min: 1, max: 2 })).toBe(
            true
        )
        expect(L_.layers.data[TILE]).toMatchObject({
            currentCogColormap: 'plasma_r',
            currentCogMin: 1,
            currentCogMax: 2,
        })

        expect(await providers['layers:setColormap']({ layerUUID: TILE, reversed: false })).toBe(
            true
        )
        expect(L_.layers.data[TILE].currentCogColormap).toBe('plasma')
    })

    // The picker's names carry direction as a `_r` suffix.
    test('reads a `_r` name as the ramp reversed', async () => {
        withLayers([tileLayer()])
        expect(await providers['layers:setColormap']({ layerUUID: TILE, name: 'RdBu_r' })).toBe(
            true
        )
        expect(L_.layers.data[TILE].currentCogColormap).toBe('rdbu_r')
    })

    test('refuses a reversal the source does not publish', async () => {
        stubService(EIC())
        withLayers([deckLayer()], { service: SERVICE })

        expect(
            await providers['layers:setColormap']({ layerUUID: DECK, reversed: true })
        ).toBe(false)
        expect(
            await providers['layers:setColormap']({ layerUUID: DECK, name: 'naqfc_pm25_r' })
        ).toBe(false)
        expect(L_.layers.data[DECK].currentCogColormap).toBeUndefined()
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    // A name given without `reversed` says the direction itself: forward
    // unless it ends in `_r`.
    test('a name without `_r` sets the ramp forward', async () => {
        stubService(EIC())
        withLayers([deckLayer({ cogColormap: 'viridis_r' })], { service: SERVICE })

        expect(
            await providers['layers:setColormap']({ layerUUID: DECK, name: 'naqfc_pm25' })
        ).toBe(true)
        expect(L_.layers.data[DECK].currentCogColormap).toBe('naqfc_pm25')
    })

    test.each([
        [{ name: 'not-a-ramp' }],
        [{ name: '' }],
        [{ min: 'low' }],
        [{ max: Number.NaN }],
        [{ reversed: 'yes' }],
    ])('refuses %j', async (change) => {
        withLayers([tileLayer()])
        expect(await providers['layers:setColormap']({ layerUUID: TILE, ...change })).toBe(false)
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('refuses a layer that cannot change its colormap', async () => {
        withLayers([
            tileLayer({ name: IMAGE, type: 'image' }),
            { name: PLAIN, type: 'tile', url: 'x/{z}/{x}/{y}.png' },
        ])
        expect(await providers['layers:setColormap']({ layerUUID: IMAGE, name: 'magma' })).toBe(
            false
        )
        expect(await providers['layers:setColormap']({ layerUUID: PLAIN, name: 'magma' })).toBe(
            false
        )
        expect(await providers['layers:setColormap']({ layerUUID: 'nope', name: 'magma' })).toBe(
            false
        )
        expect(L_.layers.data[IMAGE].currentCogColormap).toBeUndefined()
    })

    // Vector painting is its own piece of work; until it registers an applier
    // a vector layer refuses, and says why.
    test('refuses a vector layer until an applier for vectors is registered', async () => {
        withLayers([vectorLayer()])
        expect(await providers['layers:setColormap']({ layerUUID: VECTOR, name: 'magma' })).toBe(
            false
        )
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('vector layers cannot change their colormap yet')
        )

        const apply = vi.fn(() => true)
        const unregister = registerColormapApplier('vector', apply)
        try {
            expect(
                (await providers['layers:getColormapCapabilities'](VECTOR)).canChangeColormap
            ).toBe(true)
            expect(
                await providers['layers:setColormap']({
                    layerUUID: VECTOR,
                    name: 'magma',
                    reversed: true,
                    max: 20,
                })
            ).toBe(true)
            expect(apply).toHaveBeenCalledWith(
                VECTOR,
                L_.layers.data[VECTOR],
                expect.objectContaining({ name: 'magma', reversed: true, min: 1, max: 20 })
            )
        } finally {
            unregister()
        }
    })
})
