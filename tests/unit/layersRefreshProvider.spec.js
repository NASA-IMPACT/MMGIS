import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_`, which
// fina() assigns — so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * The `layers:refresh` provider re-renders a raster tile layer after a COG
 * setting changes (LayerManager's colormap and rescale controls). It no
 * longer branches on engine or renderer — it resolves the layer's source and
 * hands the uncompiled URL plus tile-URL options to
 * `Map_.engine.refreshLayer`, which is the single place that now decides how
 * (mutate in place, clone, or run a registered refresher). URL compiling and
 * registry adoption on refresh are the engine's job and are covered by
 * tests/unit/engineRefreshLayer.spec.js, not here.
 */

const TITILER_URL =
    'titiler-url:https://example.com/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=s3://bucket/scene.tif'
const RESOLVED_URL =
    'https://example.com/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=s3://bucket/scene.tif'

const makeCogLayer = (type) => ({
    name: 'Displacement',
    type,
    url: TITILER_URL,
    cogTransform: true,
    cogColormap: 'rdbu_r',
    cogMin: -0.1,
    cogMax: 0.2,
})

// A deck.gl layer carries deck's `props` and never Leaflet's `options`. Used
// only as an arbitrary registry-entry fixture here — the provider never reads
// or writes it, which several tests below assert directly.
const makeDeckLayer = (id, url) => ({ id, props: { data: url } })

let providers
let refreshLayer
// The ids the engine holds, mirroring both adapters' own layer maps.
let engineLayerIds
let timeUrlReplacements

const registerProviders = () => {
    providers = {}
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
    }
    engineLayerIds = new Set()
    // Mirrors the two documented ways a real adapter's refreshLayer says "no":
    // an id it does not hold, or (DeckGLAdapter specifically) a null url with
    // no registered refresher to fall back on.
    refreshLayer = vi.fn((id, ctx) => {
        if (!engineLayerIds.has(id)) return false
        if (ctx.url == null) return false
        return true
    })
    timeUrlReplacements = vi.fn(async (url) => url)
    L_.fina(
        null,
        {
            engine: { engineType: MAP_ENGINE.DECKGL, refreshLayer },
            nativeLayer: (layer) =>
                layer && layer._deckLayer != null ? layer._deckLayer : layer,
        },
        null,
        null,
        null,
        { performTimeUrlReplacements: (...args) => timeUrlReplacements(...args) }
    )
}

const register = (layer, registryEntry, { onEngine = true } = {}) => {
    L_.layers.data[layer.name] = layer
    L_.layers.layer[layer.name] = registryEntry
    L_.layers.on[layer.name] = true
    if (onEngine) engineLayerIds.add(layer.name)
}

describe('layers:refresh provider', () => {
    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.on = {}
        L_.layers.opacity = {}
        L_.missionPath = ''
        registerProviders()
    })

    // All three canonicalize to `tile`. The provider no longer branches on
    // this type — Map_.engine.refreshLayer does, and that's tested on its own
    // in engineRefreshLayer.spec.js.
    test.each([['TileLayer'], ['BitmapLayer'], ['tile']])(
        'passes a colormap override through to the engine for a %s layer',
        async (type) => {
            const layer = makeCogLayer(type)
            register(layer, makeDeckLayer(layer.name, 'stale'))

            const result = await providers['layers:refresh']({
                layerUUID: 'Displacement',
                options: { currentCogColormap: 'plasma' },
            })

            expect(result).toBe(true)
            expect(refreshLayer).toHaveBeenCalledTimes(1)
            const [id, ctx] = refreshLayer.mock.calls[0]
            expect(id).toBe('Displacement')
            expect(ctx.url).toBe(RESOLVED_URL)
            expect(ctx.force).toBe(false)
            expect(ctx.tileOptions.currentCogColormap).toBe('plasma')
            expect(ctx.tileOptions.cogMin).toBe(-0.1)
            expect(ctx.tileOptions.cogMax).toBe(0.2)
        }
    )

    // LayerManager writes `currentCogColormap` to the config before it asks for
    // the refresh, so the override and the config field are the same key and the
    // override has to win outright rather than merely filling a gap.
    test('a colormap override beats the one already on the config', async () => {
        const layer = { ...makeCogLayer('TileLayer'), currentCogColormap: 'magma' }
        register(layer, makeDeckLayer(layer.name, 'stale'))

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        const [, ctx] = refreshLayer.mock.calls[0]
        expect(ctx.tileOptions.currentCogColormap).toBe('plasma')
    })

    test('passes a rescale override through to the engine', async () => {
        const layer = makeCogLayer('TileLayer')
        register(layer, makeDeckLayer(layer.name, 'stale'))

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogMin: 0, currentCogMax: 5 },
        })

        const [, ctx] = refreshLayer.mock.calls[0]
        expect(ctx.tileOptions.currentCogMin).toBe(0)
        expect(ctx.tileOptions.currentCogMax).toBe(5)
    })

    // The write-back a facade-managed refresh used to need (adopting the
    // clone the engine returned) is gone — the engine's own registry is
    // authoritative now, and refreshLayer returns a boolean, not an instance.
    test('does not touch the layer registry — the engine owns that now', async () => {
        const layer = makeCogLayer('TileLayer')
        const stale = makeDeckLayer(layer.name, 'stale')
        register(layer, stale)

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(L_.layers.layer['Displacement']).toBe(stale)
    })

    test('leaves the layer config URL unmutated so the next refresh re-resolves', async () => {
        const layer = makeCogLayer('TileLayer')
        register(layer, makeDeckLayer(layer.name, 'stale'))

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(layer.url).toBe(TITILER_URL)
    })

    test('reports failure for a facade-managed layer that is not a raster tile', async () => {
        const layer = { name: 'Roads', type: 'MVTLayer', url: 'x/{z}/{x}/{y}.mvt' }
        register(layer, makeDeckLayer(layer.name, 'stale'))

        const result = await providers['layers:refresh']({
            layerUUID: 'Roads',
            options: {},
        })

        expect(result).toBe(false)
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    // A layer the engine does not hold — one toggled off, say — has nothing to
    // refresh, so the call reports false.
    test('keeps the registry entry when the engine holds no such layer', async () => {
        const layer = makeCogLayer('TileLayer')
        const stale = makeDeckLayer(layer.name, 'stale')
        register(layer, stale, { onEngine: false })

        const result = await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(result).toBe(false)
        expect(L_.layers.layer['Displacement']).toBe(stale)
    })

    test('reports failure when the layer has no config to resolve', async () => {
        L_.layers.layer['Ghost'] = makeDeckLayer('Ghost', 'stale')

        const result = await providers['layers:refresh']({
            layerUUID: 'Ghost',
            options: { currentCogColormap: 'plasma' },
        })

        expect(result).toBe(false)
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    // A `COG:` layer needs a TiTiler service to build a tile URL against, and
    // resolves to no URL without one. The call site no longer guards this
    // itself — it hands the null url to the engine, which is the one that
    // declines rather than blanking the layer (see engineRefreshLayer.spec.js).
    test('hands the engine a null url when the source resolves to none', async () => {
        const layer = {
            name: 'Displacement',
            type: 'TileLayer',
            url: 'COG:scene.tif',
            cogTransform: true,
        }
        const stale = makeDeckLayer(layer.name, 'stale')
        register(layer, stale)

        const result = await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(result).toBe(false)
        expect(refreshLayer).toHaveBeenCalledWith(
            'Displacement',
            expect.objectContaining({ url: null })
        )
        expect(L_.layers.layer['Displacement']).toBe(stale)
    })

    // Resolving a source reaches the network for a layer whose urlReplacements
    // fire on time change. The provider is driven by a UI control that cannot
    // await it, so a failure has to come back as `false` rather than reject.
    test('reports failure instead of rejecting when resolving the source throws', async () => {
        const layer = makeCogLayer('TileLayer')
        register(layer, makeDeckLayer(layer.name, 'stale'))
        timeUrlReplacements.mockRejectedValueOnce(new Error('network down'))
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})

        const result = await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(result).toBe(false)
        expect(refreshLayer).not.toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
