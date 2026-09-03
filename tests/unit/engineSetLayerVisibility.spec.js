import { describe, test, expect, vi } from 'vitest'
import LeafletAdapter from '../../src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts'
import DeckGLAdapter from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * One verb, two implementations: Leaflet takes the layer off the map, deck.gl
 * flips a prop on one it still holds. The contract both keep is that hiding
 * never gives up the hold, so anything a hidden layer is told lands on the
 * instance shown next and nothing is replayed at show time.
 */

// A Leaflet map that remembers what is on it, which is the whole of what
// visibility means on that engine.
const makeMap = () => {
    const on = new Set()
    return {
        on,
        hasLayer: (l) => on.has(l),
        addLayer: (l) => on.add(l),
        removeLayer: (l) => on.delete(l),
    }
}

const makeLeafletAdapter = () => {
    const adapter = new LeafletAdapter()
    adapter._map = makeMap()
    return adapter
}

const makeDeckLayer = (id, props = {}) => ({
    id,
    props: { id, ...props },
    clone(patch) {
        return makeDeckLayer(id, { ...props, ...patch })
    },
})

const makeDeckAdapter = () => {
    const adapter = new DeckGLAdapter()
    adapter._isOverlayMode = false
    adapter._deck = { setProps: vi.fn() }
    return adapter
}

describe('LeafletAdapter.setLayerVisibility', () => {
    test('puts a registered layer on the map when shown', () => {
        const adapter = makeLeafletAdapter()
        const layer = {}
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility('l1', true)

        expect(adapter._map.hasLayer(layer)).toBe(true)
    })

    test('takes it off the map when hidden', () => {
        const adapter = makeLeafletAdapter()
        const layer = {}
        adapter.registerLayer('l1', layer)
        adapter.setLayerVisibility('l1', true)

        adapter.setLayerVisibility('l1', false)

        expect(adapter._map.hasLayer(layer)).toBe(false)
    })

    // A hidden layer still has to be refreshable: TimeControl.reloadLayer's
    // evenIfOff path and every opacity write address it by id.
    test('keeps holding a layer it has hidden', () => {
        const adapter = makeLeafletAdapter()
        const layer = {}
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility('l1', false)

        expect(adapter.getLayers()).toContain(layer)
    })

    test('accepts the native layer object as well as its id', () => {
        const adapter = makeLeafletAdapter()
        const layer = {}
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility(layer, true)

        expect(adapter._map.hasLayer(layer)).toBe(true)
    })

    // Callers toggle layers the engine may never have been given — a layer
    // whose build failed, or one belonging to a secondary map.
    test('is a no-op for an id it does not hold', () => {
        const adapter = makeLeafletAdapter()

        expect(() => adapter.setLayerVisibility('nope', true)).not.toThrow()
        expect(adapter._map.on.size).toBe(0)
    })
})

describe('DeckGLAdapter.setLayerVisibility', () => {
    test('marks a held layer visible and hands it to deck', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1', { visible: false }))

        adapter.setLayerVisibility('l1', true)

        const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
        expect(sent.map((l) => l.id)).toEqual(['l1'])
    })

    // Withheld from deck entirely rather than handed over as visible:false.
    // deck.gl stops drawing an invisible layer but still runs its lifecycle,
    // so a hidden TileLayer left in the render list goes on requesting tiles
    // for a layer nobody asked for.
    test('withholds a hidden layer from deck while still holding it', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1'))

        adapter.setLayerVisibility('l1', false)

        expect(adapter.getLayers()).toHaveLength(1)
        const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
        expect(sent).toEqual([])
    })

    test('hands it back to deck when it is shown again', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1'))
        adapter.setLayerVisibility('l1', false)

        adapter.setLayerVisibility('l1', true)

        const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
        expect(sent.map((l) => l.id)).toEqual(['l1'])
    })

    // The hold is the point: a hidden layer stays addressable, so an opacity
    // write or a refresh while it is off still lands on it.
    test('keeps a hidden layer reachable by id', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1', { opacity: 1 }))
        adapter.setLayerVisibility('l1', false)

        adapter.setLayerOpacity('l1', 0.4)
        adapter.setLayerVisibility('l1', true)

        const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
        expect(sent[0].props.opacity).toBe(0.4)
    })

    test('accepts the native layer object as well as its id', () => {
        const adapter = makeDeckAdapter()
        const layer = makeDeckLayer('l1', { visible: false })
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility(layer, true)

        const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
        expect(sent.map((l) => l.id)).toEqual(['l1'])
    })

    test('is a no-op for an id it does not hold', () => {
        const adapter = makeDeckAdapter()

        expect(() => adapter.setLayerVisibility('nope', true)).not.toThrow()
        expect(adapter.getLayers()).toHaveLength(0)
    })

    // Under this engine MMGIS still builds data, image, video and velocity
    // layers with Leaflet. Cloning one throws, and every sync clones what the
    // engine holds, so one such entry would take the whole map down.
    test('declines a layer it could not draw, without throwing', () => {
        const adapter = makeDeckAdapter()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const leafletish = { setOpacity() {} }

        expect(() =>
            adapter.setLayerVisibility(leafletish, true)
        ).not.toThrow()
        expect(adapter.getLayers()).toHaveLength(0)

        warn.mockRestore()
    })
})

/**
 * `hasLayer` answers "is this on the map", not "does the engine know about
 * it". The distinction only became visible once an engine could hold a layer
 * it is not drawing: mmgisAPI publishes this answer as `map:hasLayer`, and
 * the two engines must not disagree about a hidden layer.
 */
describe('hasLayer once an engine holds a layer it is not drawing', () => {
    test('LeafletAdapter says no for a registered layer it has hidden', () => {
        const adapter = makeLeafletAdapter()
        const layer = {}
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility('l1', false)

        expect(adapter.hasLayer('l1')).toBe(false)
        expect(adapter.hasLayer(layer)).toBe(false)
    })

    test('DeckGLAdapter says no for a held layer it has hidden', () => {
        const adapter = makeDeckAdapter()
        const layer = makeDeckLayer('l1')
        adapter.registerLayer('l1', layer)

        adapter.setLayerVisibility('l1', false)

        expect(adapter.hasLayer('l1')).toBe(false)
    })

    test('DeckGLAdapter says yes once the layer is shown again', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1'))
        adapter.setLayerVisibility('l1', false)

        adapter.setLayerVisibility('l1', true)

        expect(adapter.hasLayer('l1')).toBe(true)
    })

    // A layer built and handed over without anyone saying otherwise is drawn,
    // so the default has to read as visible rather than as unset.
    test('DeckGLAdapter says yes for a freshly registered layer', () => {
        const adapter = makeDeckAdapter()
        adapter.registerLayer('l1', makeDeckLayer('l1'))

        expect(adapter.hasLayer('l1')).toBe(true)
    })
})
