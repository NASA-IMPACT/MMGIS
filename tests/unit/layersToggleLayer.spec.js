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
 * Turning a layer on under the deck.gl engine. A layer configured off at load
 * is built but never handed to the engine, so the first toggle-on is the
 * moment the engine adopts the creation-time instance. Whatever changed while
 * it was hidden — the opacity slider, a colormap pick, a config update — only
 * reached the registry by then, and has to be re-applied on adoption or the
 * map shows creation-time values while the panel shows the new ones.
 */

// A deck.gl engine that holds what it is given and hides rather than removes.
const makeDeckEngine = () => {
    const held = new Set()
    return {
        engineType: MAP_ENGINE.DECKGL,
        updateLayer: vi.fn((layer) => (held.has(layer.id) ? layer : undefined)),
        addLayer: vi.fn((layer) => held.add(layer.id)),
        setLayerOpacity: vi.fn(),
        setLayerZIndex: vi.fn(),
        refreshLayer: vi.fn(() => true),
    }
}

const FLOOD = {
    name: 'Flood Extent',
    type: 'TileLayer',
    url: 'https://example.com/flood/{z}/{x}/{y}.png',
    tileformat: 'wmts',
}

let engine

beforeEach(() => {
    engine = makeDeckEngine()
    L_.Map_ = {
        engine,
        nativeLayer: (layer) =>
            layer && layer._deckLayer != null ? layer._deckLayer : layer,
    }
    L_.Globe_ = null
    L_.activeFeature = null
    L_.missionPath = ''
    L_.TimeControl_ = { performTimeUrlReplacements: async (url) => url }
    L_._layersOrdered = [FLOOD.name]
    L_.layers.data = { [FLOOD.name]: FLOOD }
    L_.layers.layer = { [FLOOD.name]: { id: FLOOD.name, props: { opacity: 1 } } }
    L_.layers.attachments = {}
    L_.layers.on = { [FLOOD.name]: false }
    L_.layers.opacity = { [FLOOD.name]: 1 }
})

const callOrder = (fn) => fn.mock.invocationCallOrder[0]

describe('turning on a deck.gl layer the engine has never held', () => {
    test('re-applies the opacity chosen while it was hidden, after adopting it', async () => {
        L_.layers.opacity[FLOOD.name] = 0.4

        await L_.toggleLayerHelper(FLOOD, false)

        expect(engine.addLayer).toHaveBeenCalledWith(L_.layers.layer[FLOOD.name])
        const applied = engine.setLayerOpacity.mock.calls.find(
            ([layer]) => layer === L_.layers.layer[FLOOD.name]
        )
        expect(applied[1]).toBe(0.4)
        expect(callOrder(engine.setLayerOpacity)).toBeGreaterThan(
            callOrder(engine.addLayer)
        )
    })

    test('re-runs its refresher so config changed while hidden reaches the map', async () => {
        await L_.toggleLayerHelper(FLOOD, false)

        expect(engine.refreshLayer).toHaveBeenCalledTimes(1)
        const [id, ctx] = engine.refreshLayer.mock.calls[0]
        expect(id).toBe(FLOOD.name)
        expect(ctx.url).toBe(FLOOD.url)
        expect(callOrder(engine.refreshLayer)).toBeGreaterThan(
            callOrder(engine.addLayer)
        )
    })

    // An unranked deck.gl layer draws on top of the whole stack, and the
    // refresh can wait on a network round trip, so the rank has to land
    // first — and exactly once each time it is shown. Ranking re-sorts the
    // stack and pushes every layer to deck.gl; a caller that re-ranks what
    // showLayerOnEngine already ranked pays for that twice.
    test('ranks the layer once each time it is shown, before the refresh runs', async () => {
        await L_.toggleLayerHelper(FLOOD, false)

        // Every path that shows the layer starts by asking the engine
        // whether it is already held, so that count is how many times the
        // layer was shown.
        const timesShown = engine.updateLayer.mock.calls.length
        expect(engine.setLayerZIndex).toHaveBeenCalledTimes(timesShown)
        expect(callOrder(engine.setLayerZIndex)).toBeLessThan(
            callOrder(engine.refreshLayer)
        )
    })
})

describe('turning on a layer under the Leaflet engine', () => {
    test('adds it to the map and nothing more', async () => {
        engine.engineType = MAP_ENGINE.LEAFLET
        L_.layers.opacity[FLOOD.name] = 0.4

        await L_.toggleLayerHelper(FLOOD, false)

        expect(engine.addLayer).toHaveBeenCalledWith(L_.layers.layer[FLOOD.name])
        expect(engine.updateLayer).not.toHaveBeenCalled()
        expect(engine.setLayerOpacity).not.toHaveBeenCalled()
        expect(engine.refreshLayer).not.toHaveBeenCalled()
    })
})

describe('turning on a deck.gl layer the engine already holds', () => {
    test('only flips it visible; the held instance is already current', async () => {
        engine.addLayer(L_.layers.layer[FLOOD.name])
        engine.addLayer.mockClear()

        await L_.toggleLayerHelper(FLOOD, false)

        expect(engine.updateLayer).toHaveBeenCalledWith(
            L_.layers.layer[FLOOD.name],
            { visible: true }
        )
        expect(engine.addLayer).not.toHaveBeenCalled()
        expect(engine.setLayerOpacity).not.toHaveBeenCalled()
        expect(engine.refreshLayer).not.toHaveBeenCalled()
    })
})
