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
 * L_.setLayerOpacity no longer branches on the layer's shape: every registry
 * entry that is not the load-failure sentinel or an aggregate array is handed
 * to the active engine's setLayerOpacity, once per compound part (main layer,
 * then each attachment). Which engine is active, and what shape its native
 * layer objects carry, is the engine's business, not the caller's.
 */

// A deck.gl Layer stands in as a non-Leaflet native layer: it has `props`,
// never `options`.
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

describe('L_.setLayerOpacity asks the engine per part', () => {
    beforeEach(resetRegistry)

    test('every layer goes through the engine, whichever engine is active', () => {
        for (const engineType of [MAP_ENGINE.LEAFLET, MAP_ENGINE.DECKGL]) {
            const setLayerOpacity = vi.fn()
            setEngine(engineType, setLayerOpacity)
            L_.layers.layer.a = makeLeafletLayer()
            L_.setLayerOpacity('a', 0.5)
            expect(setLayerOpacity).toHaveBeenCalledTimes(1)
        }
    })

    test('passes the configured fill opacity scaled by the new opacity', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()
        L_.layers.data.a = { style: { fillOpacity: 0.4 } }

        L_.setLayerOpacity('a', 0.5)
        expect(setLayerOpacity.mock.calls[0][2]).toEqual({ fillOpacity: 0.2 })
    })

    test('an opacity of 0 reaches the engine rather than being read as unset', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()
        L_.setLayerOpacity('a', 0)
        expect(setLayerOpacity.mock.calls[0][1]).toBe(0)
        expect(L_.layers.opacity.a).toBe(0)
    })

    test('asks the engine once per attachment as well as for the main layer', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()
        const labels = makeLeafletLayer()
        L_.layers.attachments.a = { labels: { type: 'labels', layer: labels } }

        L_.setLayerOpacity('a', 0.5)
        expect(setLayerOpacity).toHaveBeenCalledTimes(2)
        expect(setLayerOpacity.mock.calls[1][0]).toBe(labels)
    })

    test('uncertainty ellipses keep their own dimming factors', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()
        L_.layers.data.a = { style: { fillOpacity: 1 } }
        const ellipses = makeLeafletLayer()
        L_.layers.attachments.a = {
            uncertainty_ellipses: { type: 'uncertainty_ellipses', layer: ellipses },
        }

        L_.setLayerOpacity('a', 0.5)
        const [, opacity, options] = setLayerOpacity.mock.calls[1]
        expect(opacity).toBeCloseTo(0.4)   // 0.5 * 0.8
        expect(options.fillOpacity).toBeCloseTo(0.125) // 0.5 * 1 * 0.25
    })

    test('skips model attachments, which have no 2D layer', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()
        L_.layers.attachments.a = { models: { type: 'model', layer: makeLeafletLayer() } }

        L_.setLayerOpacity('a', 0.5)
        expect(setLayerOpacity).toHaveBeenCalledTimes(1)
    })

    test('a load-failure sentinel (false) skips the engine but still records opacity', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.DECKGL, setLayerOpacity)
        L_.layers.layer.a = false
        L_.setLayerOpacity('a', 0.5)
        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(L_.layers.opacity.a).toBe(0.5)
    })

    test('an aggregate registry entry (array of layers) is not routed to the engine', () => {
        const setLayerOpacity = vi.fn()
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = [makeLeafletLayer(), makeLeafletLayer()]
        L_.setLayerOpacity('a', 0.5)
        expect(setLayerOpacity).not.toHaveBeenCalled()
        expect(L_.layers.opacity.a).toBe(0.5)
    })

    test('is a no-op on the engine before Map_ is initialized', () => {
        L_.Map_ = null
        L_.layers.layer.a = makeLeafletLayer()
        expect(() => L_.setLayerOpacity('a', 0.5)).not.toThrow()
        expect(L_.layers.opacity.a).toBe(0.5)
    })

    // The registry is the sole source of truth for opacity — getLayerOpacity
    // reads it and layer creation seeds itself from it — so the write must not
    // sit behind calls that can throw, such as an attachment's.
    test('records the opacity even when an engine call throws', () => {
        const setLayerOpacity = vi.fn(() => {
            throw new Error('attachment blew up')
        })
        setEngine(MAP_ENGINE.LEAFLET, setLayerOpacity)
        L_.layers.layer.a = makeLeafletLayer()

        expect(() => L_.setLayerOpacity('a', 0.5)).toThrow()
        expect(L_.layers.opacity.a).toBe(0.5)
    })
})

describe('L_.getLayerOpacity reads the registry', () => {
    beforeEach(resetRegistry)

    test('reads a Leaflet layer from the registry, not its options', () => {
        setEngine(MAP_ENGINE.LEAFLET, vi.fn())
        const layer = makeLeafletLayer()
        layer.options.style.opacity = 0.9 // a stale mirror must not win
        L_.layers.layer.a = layer
        L_.layers.opacity.a = 0.3
        expect(L_.getLayerOpacity('a')).toBe(0.3)
    })

    test('reads an engine-owned layer from the registry', () => {
        setEngine(MAP_ENGINE.DECKGL, vi.fn())
        L_.layers.layer.a = makeEngineLayer('a', 1)
        L_.layers.opacity.a = 0.25
        expect(L_.getLayerOpacity('a')).toBe(0.25)
    })

    test('reads 0 rather than falling back to 1', () => {
        setEngine(MAP_ENGINE.LEAFLET, vi.fn())
        L_.layers.layer.a = makeLeafletLayer()
        L_.layers.opacity.a = 0
        expect(L_.getLayerOpacity('a')).toBe(0)
    })

    test('defaults to 1 when the registry has no entry', () => {
        setEngine(MAP_ENGINE.LEAFLET, vi.fn())
        L_.layers.layer.a = makeLeafletLayer()
        expect(L_.getLayerOpacity('a')).toBe(1)
    })

    test('returns 0 for a layer that has not been built', () => {
        setEngine(MAP_ENGINE.LEAFLET, vi.fn())
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
