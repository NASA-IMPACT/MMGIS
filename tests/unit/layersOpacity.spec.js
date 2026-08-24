import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_`, which each
// test assigns — so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * L_.setLayerOpacity dispatches on which API the layer object answers to, not
 * on the layer's configured type: under a non-Leaflet engine the registry holds
 * a mix of facade-managed layers (vector, tile, vectortile) and Leaflet-built
 * ones (velocity, model, data, image, video). Facade-managed layers are
 * immutable in deck.gl, so the facade returns a replacement the registry must
 * adopt.
 */

// A deck.gl Layer stands in as any facade-managed object: it has `props`, never
// `options`, and cannot be mutated in place.
const makeEngineLayer = (id, opacity) => ({ id, props: { opacity } })

// A Leaflet layer always carries `options` and mutates in place.
const makeLeafletLayer = () => ({
    options: { style: {} },
    setOpacity(o) {
        this.options.opacity = o
        this.options.style.opacity = o
    },
})

const setEngine = (engineType, setLayerOpacity) => {
    L_.Map_ = {
        engine: { engineType, setLayerOpacity },
        nativeLayer: (layer) =>
            layer && layer._deckLayer != null ? layer._deckLayer : layer,
    }
}

const resetRegistry = () => {
    L_.layers.layer = {}
    L_.layers.opacity = {}
    L_.layers.data = {}
    L_.layers.attachments = {}
    L_.Globe_ = null
    L_.activeFeature = null
}

describe('L_.setLayerOpacity engine dispatch', () => {
    beforeEach(() => {
        resetRegistry()
        L_.Map_ = null
    })

    test('facade-managed layer is routed through the facade', () => {
        const setLayerOpacity = vi.fn(() => makeEngineLayer('vec', 0.4))
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        const original = makeEngineLayer('vec', 1)
        L_.layers.layer.vec = original

        L_.setLayerOpacity('vec', 0.4)

        expect(setLayerOpacity).toHaveBeenCalledWith(original, 0.4)
    })

    test('the instance returned by the engine replaces the registry entry', () => {
        const replacement = makeEngineLayer('vec', 0.4)
        setEngine(MAP_ENGINE.DECKGL, () => replacement)
        L_.layers.layer.vec = makeEngineLayer('vec', 1)

        L_.setLayerOpacity('vec', 0.4)

        expect(L_.layers.layer.vec).toBe(replacement)
        expect(L_.layers.opacity.vec).toBe(0.4)
    })

    test('the registry entry is kept when the engine returns nothing', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)
        const original = makeEngineLayer('vec', 1)
        L_.layers.layer.vec = original

        L_.setLayerOpacity('vec', 0.4)

        expect(L_.layers.layer.vec).toBe(original)
        expect(L_.layers.opacity.vec).toBe(0.4)
    })

    test('an opacity of 0 reaches the engine rather than being read as unset', () => {
        const setLayerOpacity = vi.fn(() => makeEngineLayer('vec', 0))
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        L_.layers.layer.vec = makeEngineLayer('vec', 1)

        L_.setLayerOpacity('vec', 0)

        expect(setLayerOpacity).toHaveBeenCalledWith(expect.anything(), 0)
        expect(L_.layers.opacity.vec).toBe(0)
    })

    test('a Leaflet-built layer under a deck.gl engine stays on the Leaflet path', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        const velocity = makeLeafletLayer()
        L_.layers.layer.wind = velocity

        L_.setLayerOpacity('wind', 0.3)

        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(velocity.options.opacity).toBe(0.3)
    })

    test('every layer stays on the Leaflet path under the Leaflet engine', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        const leafletLayer = makeLeafletLayer()
        L_.layers.layer.vec = leafletLayer

        L_.setLayerOpacity('vec', 0.3)

        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(leafletLayer.options.opacity).toBe(0.3)
    })

    test('a facade-managed layer is left alone before Map_ is initialized', () => {
        L_.Map_ = null
        L_.layers.layer.vec = makeEngineLayer('vec', 1)

        expect(() => L_.setLayerOpacity('vec', 0.4)).not.toThrow()
        expect(L_.layers.opacity.vec).toBe(0.4)
    })

    test('a load-failure sentinel (false) under deck.gl skips the engine and keeps the registry write', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        L_.layers.layer.vec = false

        expect(() => L_.setLayerOpacity('vec', 0.4)).not.toThrow()

        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(L_.layers.layer.vec).toBe(false)
        expect(L_.layers.opacity.vec).toBe(0.4)
    })

    test('an aggregate registry entry (array of Leaflet layers) is not routed to the engine', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        L_.layers.layer.arrows = [makeLeafletLayer(), makeLeafletLayer()]

        expect(() => L_.setLayerOpacity('arrows', 0.4)).not.toThrow()

        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(L_.layers.opacity.arrows).toBe(0.4)
    })
})

describe('L_.getLayerOpacity engine dispatch', () => {
    beforeEach(() => {
        resetRegistry()
        L_.Map_ = null
    })

    test('reads a facade-managed layer from the registry', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)
        L_.layers.layer.vec = makeEngineLayer('vec', 1)
        L_.layers.opacity.vec = 0.25

        expect(L_.getLayerOpacity('vec')).toBe(0.25)
    })

    test('reads 0 from the registry rather than falling back to 1', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)
        L_.layers.layer.vec = makeEngineLayer('vec', 0)
        L_.layers.opacity.vec = 0

        expect(L_.getLayerOpacity('vec')).toBe(0)
    })

    test('defaults to 1 when the registry has no entry for the layer', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)
        L_.layers.layer.vec = makeEngineLayer('vec', 1)

        expect(L_.getLayerOpacity('vec')).toBe(1)
    })

    test('round-trips through setLayerOpacity', () => {
        setEngine(MAP_ENGINE.DECKGL, (layer, opacity) =>
            makeEngineLayer('vec', opacity)
        )
        L_.layers.layer.vec = makeEngineLayer('vec', 1)

        L_.setLayerOpacity('vec', 0.6)

        expect(L_.getLayerOpacity('vec')).toBe(0.6)
    })

    test('reads a Leaflet layer from its own style under a deck.gl engine', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)
        const velocity = makeLeafletLayer()
        velocity.options.style.opacity = 0.7
        L_.layers.layer.wind = velocity

        expect(L_.getLayerOpacity('wind')).toBe(0.7)
    })

    test('returns 0 for a layer that has not been built', () => {
        setEngine(MAP_ENGINE.DECKGL, () => undefined)

        expect(L_.getLayerOpacity('missing')).toBe(0)
    })
})

/**
 * `on=<layer>$<opacity>` seeds L_.layers.opacity before any layer is built, so
 * a url-given 0 has to survive into the registry the engines read from.
 */
describe('initial opacity from the url', () => {
    const configFor = (initialOpacity) => ({
        msv: { mission: 'Test', view: [0, 0, 3], site: '' },
        panels: { viewer: false, globe: false },
        tools: [],
        layers: [
            {
                name: 'Vec',
                display_name: 'Vec',
                type: 'vector',
                initialOpacity,
            },
        ],
    })

    const initWith = async (initialOpacity, opacityFromUrl) =>
        L_.init(configFor(initialOpacity), [], {
            onLayers: { Vec: { opacity: opacityFromUrl } },
            method: 'replace',
        })

    test('a url opacity of 0 is kept rather than falling back to 1', async () => {
        await initWith(1, 0)
        expect(L_.layers.opacity.Vec).toBe(0)
    })

    test('a url opacity in range overrides the configured one', async () => {
        await initWith(1, 0.35)
        expect(L_.layers.opacity.Vec).toBe(0.35)
    })

    test('a missing url opacity parses to NaN and falls back to 1', async () => {
        await initWith(1, Number.NaN)
        expect(L_.layers.opacity.Vec).toBe(1)
    })

    test('an out-of-range url opacity falls back to 1', async () => {
        await initWith(1, 4)
        expect(L_.layers.opacity.Vec).toBe(1)
    })

    test('a configured initialOpacity of 0 is kept when the url says nothing', async () => {
        await L_.init(configFor(0), [], null)
        expect(L_.layers.opacity.Vec).toBe(0)
    })

    test('a cleared configure field (empty string) falls back to 1', async () => {
        await L_.init(configFor(''), [], null)
        expect(L_.layers.opacity.Vec).toBe(1)
    })

    test('a numeric-string initialOpacity is stored as a number', async () => {
        await L_.init(configFor('0.5'), [], null)
        expect(L_.layers.opacity.Vec).toBe(0.5)
    })
})
