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
 * setting changes (LayerManager's colormap and rescale controls).
 *
 * The two engines reach that end differently. A Leaflet tile layer recompiles
 * its URL per tile from `this.options`, so merging the overrides into those
 * options is the whole job. A deck.gl layer is built around one static URL, so
 * the same overrides have to be compiled into a new URL and the layer rebuilt
 * around the result.
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

const registerProviders = () => {
    providers = {}
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
    }
    updateLayer = vi.fn((id, options) => makeDeckLayer(id, options.url))
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
        { performTimeUrlReplacements: async (url) => url }
    )
}

const register = (layer, registryEntry) => {
    L_.layers.data[layer.name] = layer
    L_.layers.layer[layer.name] = registryEntry
    L_.layers.on[layer.name] = true
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

    test.each([['TileLayer'], ['BitmapLayer'], ['tile']])(
        'compiles a colormap override into a new URL for a %s layer',
        async (type) => {
            const layer = makeCogLayer(type)
            register(layer, makeDeckLayer(layer.name, 'stale'))

            const result = await providers['layers:refresh']({
                layerUUID: 'Displacement',
                options: { cogColormap: 'plasma' },
            })

            expect(result).toBe(true)
            expect(updateLayer).toHaveBeenCalledTimes(1)
            const [id, options] = updateLayer.mock.calls[0]
            expect(id).toBe('Displacement')
            expect(options.url).toContain('colormap_name=plasma')
            expect(options.url).toContain('rescale=-0.1%2C0.2')
        }
    )

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
            options: { cogColormap: 'plasma' },
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
            options: { cogColormap: 'plasma' },
        })

        expect(layer.url).toBe(TITILER_URL)
    })

    test('a Leaflet tile layer still takes its own refresh()', async () => {
        const layer = makeCogLayer('tile')
        const refresh = vi.fn()
        register(layer, { options: {}, refresh })

        const result = await providers['layers:refresh']({
            layerUUID: 'Displacement',
            options: { cogColormap: 'plasma' },
        })

        expect(result).toBe(true)
        expect(refresh).toHaveBeenCalledWith(null, false, {
            cogColormap: 'plasma',
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
})
