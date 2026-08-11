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
 * setting changes (LayerManager's colormap and rescale controls), down either
 * the Leaflet or the engine-owned path.
 */

const TITILER_URL =
    'titiler-url:https://example.com/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=s3://bucket/scene.tif'

const makeCogLayer = (type) => ({
    name: 'Displacement',
    type,
    url: TITILER_URL,
    cogTransform: true,
    cogColormap: 'rdbu_r',
    cogMin: -0.1,
    cogMax: 0.2,
})

// A deck.gl layer carries deck's `props` and never Leaflet's `options`.
const makeDeckLayer = (id, url) => ({ id, props: { data: url } })

let providers
let updateLayer
// The ids the engine holds, mirroring DeckGLAdapter's own layer map.
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
    // DeckGLAdapter.updateLayer clones the layer it holds and returns the
    // replacement, and returns undefined for an id it does not hold.
    updateLayer = vi.fn((id, options) =>
        engineLayerIds.has(id) ? makeDeckLayer(id, options.url) : undefined
    )
    timeUrlReplacements = vi.fn(async (url) => url)
    L_.fina(
        null,
        {
            engine: { engineType: MAP_ENGINE.DECKGL, updateLayer },
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

    // All three canonicalize to `tile`. What routes a layer down the
    // engine-owned branch is the shape of its registry entry, not this type.
    test.each([['TileLayer'], ['BitmapLayer'], ['tile']])(
        'compiles a colormap override into a new URL for a %s layer',
        async (type) => {
            const layer = makeCogLayer(type)
            register(layer, makeDeckLayer(layer.name, 'stale'))

            const result = await providers['layers:refresh']({
                layerUUID: 'Displacement',
                options: { currentCogColormap: 'plasma' },
            })

            expect(result).toBe(true)
            expect(updateLayer).toHaveBeenCalledTimes(1)
            const [id, options] = updateLayer.mock.calls[0]
            expect(id).toBe('Displacement')
            expect(options.url).toContain('colormap_name=plasma')
            expect(options.url).toContain('rescale=-0.1%2C0.2')
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

        const [, options] = updateLayer.mock.calls[0]
        expect(options.url).toContain('colormap_name=plasma')
        expect(options.url).not.toContain('magma')
    })

    test('compiles a rescale override into a new URL', async () => {
        const layer = makeCogLayer('TileLayer')
        register(layer, makeDeckLayer(layer.name, 'stale'))

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogMin: 0, currentCogMax: 5 },
        })

        const [, options] = updateLayer.mock.calls[0]
        expect(options.url).toContain('rescale=0%2C5')
    })

    test('adopts the replacement instance the engine returns', async () => {
        const layer = makeCogLayer('TileLayer')
        const stale = makeDeckLayer(layer.name, 'stale')
        register(layer, stale)

        await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(L_.layers.layer['Displacement']).not.toBe(stale)
        expect(L_.layers.layer['Displacement'].props.data).toContain(
            'colormap_name=plasma'
        )
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

    // The provider hands the overrides to Leaflet's refresh() untouched — the
    // same `currentCogColormap` key the engine-owned branch compiles itself.
    test('a Leaflet tile layer still takes its own refresh()', async () => {
        const layer = makeCogLayer('tile')
        const refresh = vi.fn()
        register(layer, { options: {}, refresh })

        const result = await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { currentCogColormap: 'plasma' },
        })

        expect(result).toBe(true)
        expect(refresh).toHaveBeenCalledWith(null, false, {
            currentCogColormap: 'plasma',
        })
        expect(updateLayer).not.toHaveBeenCalled()
    })

    test('reports failure for an engine-owned layer that is not a raster tile', async () => {
        const layer = { name: 'Roads', type: 'MVTLayer', url: 'x/{z}/{x}/{y}.mvt' }
        register(layer, makeDeckLayer(layer.name, 'stale'))

        const result = await providers['layers:refresh']({
            layerUUID: 'Roads',
            options: {},
        })

        expect(result).toBe(false)
        expect(updateLayer).not.toHaveBeenCalled()
    })

    // A layer the engine does not hold — one toggled off, say — has nothing to
    // clone, so the registry has to keep the instance it already has.
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
        expect(updateLayer).not.toHaveBeenCalled()
    })

    // A `COG:` layer needs a TiTiler service to build a tile URL against, and
    // resolves to nothing without one.
    test('leaves the layer alone when the source resolves to no URL', async () => {
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
        expect(updateLayer).not.toHaveBeenCalled()
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
        expect(updateLayer).not.toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
