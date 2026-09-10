import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_`, which
// fina() assigns — so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// A re-order hides the hover tooltip, which reaches into a div Map_ creates
// at init. Not the behaviour under test, and absent in this context.
vi.mock('../../src/essence/Ancillary/CursorInfo', () => ({
    default: { hide: vi.fn(), update: vi.fn() },
}))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * Draw order over the bus: `layers:getOrder` reads the stack top first,
 * `layers:setOrder` hands a permutation back, and every applied change
 * reaches the engine, Leaflet's own re-order, and 'layers:orderChanged'.
 */

let providers
let emitted
let engine

const seed = (order, loaded) => {
    L_.layers.data = {}
    L_.layers.nameToUUID = {}
    L_.layers.layer = {}
    L_.layers.attachments = {}
    order.forEach((uuid) => {
        L_.layers.data[uuid] = { name: uuid, display_name: `Name ${uuid}`, type: 'vector' }
        L_.layers.nameToUUID[`Name ${uuid}`] = [uuid]
    })
    L_._layersOrdered = [...order]
    L_._layersLoaded = [...loaded]
}

beforeEach(() => {
    providers = {}
    emitted = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (name, payload) => emitted.push([name, payload]),
    }
    engine = {
        engineType: MAP_ENGINE.DECKGL,
        setLayerOrder: vi.fn(),
        bringToFront: vi.fn(),
    }
    L_.fina(
        null,
        { engine, nativeLayer: (l) => l, map: { hasLayer: () => false } },
        null,
        null,
        null,
        {}
    )
    seed(['a', 'b', 'c'], [true, false, true])
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('layers:getOrder', () => {
    test('returns the stack top first as a copy', () => {
        const order = providers['layers:getOrder']()
        expect(order).toEqual(['a', 'b', 'c'])
        order.reverse()
        expect(L_._layersOrdered).toEqual(['a', 'b', 'c'])
    })
})

describe('layers:setOrder', () => {
    test('applies a permutation and reports it everywhere', () => {
        expect(providers['layers:setOrder']({ order: ['c', 'a', 'b'] })).toBe(true)

        expect(L_._layersOrdered).toEqual(['c', 'a', 'b'])
        expect(engine.setLayerOrder).toHaveBeenCalledTimes(1)
        expect(engine.setLayerOrder.mock.calls[0][0]).toEqual(['c', 'a', 'b'])
        expect(emitted).toEqual([
            ['layers:orderChanged', { order: ['c', 'a', 'b'] }],
        ])
    })

    test('resolves display names the way other layer-keyed providers do', () => {
        expect(providers['layers:setOrder']({ order: ['Name b', 'a', 'Name c'] })).toBe(true)
        expect(L_._layersOrdered).toEqual(['b', 'a', 'c'])
    })

    test('moves the loaded flags with their layers', () => {
        providers['layers:setOrder']({ order: ['b', 'c', 'a'] })
        expect(L_._layersLoaded).toEqual([false, true, true])
    })

    test.each([
        ['a layer is missing', { order: ['a', 'b'] }],
        ['a layer is unknown', { order: ['a', 'b', 'nope'] }],
        ['a layer repeats', { order: ['a', 'a', 'b'] }],
        ['the order is not an array', { order: 'a,b,c' }],
        ['there is no payload', undefined],
    ])('refuses when %s and touches nothing', (_label, payload) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(providers['layers:setOrder'](payload)).toBe(false)

        expect(L_._layersOrdered).toEqual(['a', 'b', 'c'])
        expect(L_._layersLoaded).toEqual([true, false, true])
        expect(engine.setLayerOrder).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })
})

describe('what the engine is handed', () => {
    test('each layer\'s type and its attachments, a model attachment marked off', () => {
        L_.layers.data.b.type = 'tile'
        const labels = { id: 'labels' }
        const model = { id: 'model' }
        const hidden = { id: 'hidden' }
        L_.layers.attachments.a = {
            labels: { layer: labels, on: true, type: 'labels' },
            model: { layer: model, on: true, type: 'model' },
            hidden: { layer: hidden, on: false, type: 'labels' },
        }

        providers['layers:setOrder']({ order: ['b', 'a', 'c'] })

        expect(engine.setLayerOrder.mock.calls[0][1]).toEqual({
            layers: {
                a: {
                    type: 'vector',
                    attachments: [
                        { layer: labels, on: true },
                        { layer: model, on: false },
                        { layer: hidden, on: false },
                    ],
                },
                b: { type: 'tile', attachments: [] },
                c: { type: 'vector', attachments: [] },
            },
        })
    })

    test('drawings are brought to the front after the order is pushed', () => {
        const sketch = { id: 'sketch' }
        L_.layers.layer.DrawTool_1 = [sketch]
        L_.layers.layer.a = { id: 'a' }

        providers['layers:setOrder']({ order: ['b', 'a', 'c'] })

        expect(engine.bringToFront).toHaveBeenCalledTimes(1)
        expect(engine.bringToFront).toHaveBeenCalledWith(sketch)
        expect(engine.setLayerOrder.mock.invocationCallOrder[0]).toBeLessThan(
            engine.bringToFront.mock.invocationCallOrder[0]
        )
    })
})

describe('resetConfig', () => {
    let parseConfig

    beforeEach(() => {
        parseConfig = L_.parseConfig
    })

    afterEach(() => {
        L_.parseConfig = parseConfig
    })

    // resetConfig lets parseConfig rebuild the order from the config. Stand in
    // for it with the config order a parse would produce.
    const parsesTo = (order) => {
        L_.parseConfig = vi.fn(async () => {
            L_._layersOrdered.push(...order)
            L_._layersLoaded.push(...order.map(() => false))
        })
    }

    test('keeps a user order across an added layer, slotting it at its config index', async () => {
        providers['layers:setOrder']({ order: ['c', 'a', 'b'] })
        engine.setLayerOrder.mockClear()
        emitted.length = 0
        parsesTo(['a', 'n', 'b', 'c'])

        await L_.resetConfig({})

        expect(L_._layersOrdered).toEqual(['c', 'n', 'a', 'b'])
        expect(L_._layersLoaded).toHaveLength(4)
        expect(engine.setLayerOrder.mock.calls[0][0]).toEqual(['c', 'n', 'a', 'b'])
        expect(emitted).toEqual([
            ['layers:orderChanged', { order: ['c', 'n', 'a', 'b'] }],
        ])
    })

    test('keeps a user order across a removed layer', async () => {
        providers['layers:setOrder']({ order: ['c', 'a', 'b'] })
        parsesTo(['a', 'c'])

        await L_.resetConfig({})

        expect(L_._layersOrdered).toEqual(['c', 'a'])
    })

    test('leaves the config order alone when nothing was re-ordered', async () => {
        parsesTo(['a', 'n', 'b', 'c'])

        await L_.resetConfig({})

        expect(L_._layersOrdered).toEqual(['a', 'n', 'b', 'c'])
        expect(engine.setLayerOrder).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })
})
