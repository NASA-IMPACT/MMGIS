import { describe, test, expect } from 'vitest'
import LeafletAdapter from '../../src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts'
import DeckGLAdapter from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * Opacity POLICY (fill scaling, decoration factors) stays with the caller and
 * arrives as options.fillOpacity. The adapter only knows how its own engine
 * applies opacity — setOpacity for tile-ish layers, setStyle for vectors.
 */
const makeTileish = () => ({
    opacity: null,
    setOpacity(o) { this.opacity = o },
})

const makeVector = () => ({
    style: null,
    setStyle(s) { this.style = s },
})

const makeDeckLayer = (id, props = {}) => ({
    id,
    props: { id, ...props },
    clone(patch) { return makeDeckLayer(id, { ...props, ...patch }) },
})

describe('LeafletAdapter.setLayerOpacity', () => {
    test('uses setOpacity when the layer offers it', () => {
        const adapter = new LeafletAdapter()
        const layer = makeTileish()
        adapter.setLayerOpacity(layer, 0.5)
        expect(layer.opacity).toBe(0.5)
    })

    test('falls back to setStyle for a vector layer', () => {
        const adapter = new LeafletAdapter()
        const layer = makeVector()
        adapter.setLayerOpacity(layer, 0.5, { fillOpacity: 0.2 })
        expect(layer.style).toEqual({ opacity: 0.5, fillOpacity: 0.2 })
    })

    test('defaults fillOpacity to the opacity when the caller supplies none', () => {
        const adapter = new LeafletAdapter()
        const layer = makeVector()
        adapter.setLayerOpacity(layer, 0.5)
        expect(layer.style).toEqual({ opacity: 0.5, fillOpacity: 0.5 })
    })

    test('resolves a string id through the registry', () => {
        const adapter = new LeafletAdapter()
        const layer = makeTileish()
        adapter.registerLayer('l1', layer)
        adapter.setLayerOpacity('l1', 0.25)
        expect(layer.opacity).toBe(0.25)
    })

    test('an opacity of 0 is applied, not read as unset', () => {
        const adapter = new LeafletAdapter()
        const layer = makeTileish()
        adapter.setLayerOpacity(layer, 0)
        expect(layer.opacity).toBe(0)
    })

    test('returns nothing and tolerates a layer answering to neither API', () => {
        const adapter = new LeafletAdapter()
        expect(adapter.setLayerOpacity({}, 0.5)).toBeUndefined()
    })
})

describe('DeckGLAdapter.setLayerOpacity', () => {
    test('replaces the held instance and returns nothing', () => {
        const adapter = new DeckGLAdapter()
        const original = makeDeckLayer('l1', { opacity: 1 })
        adapter.addLayer(original)

        expect(adapter.setLayerOpacity('l1', 0.5)).toBeUndefined()
        const held = adapter.getLayers().find((l) => l.id === 'l1')
        expect(held).not.toBe(original)
        expect(held.props.opacity).toBe(0.5)
    })

    test('an opacity of 0 reaches the layer', () => {
        const adapter = new DeckGLAdapter()
        adapter.addLayer(makeDeckLayer('l1', { opacity: 1 }))
        adapter.setLayerOpacity('l1', 0)
        expect(adapter.getLayers().find((l) => l.id === 'l1').props.opacity).toBe(0)
    })

    test('is a no-op for an id the engine does not hold', () => {
        const adapter = new DeckGLAdapter()
        expect(adapter.setLayerOpacity('nope', 0.5)).toBeUndefined()
        expect(adapter.getLayers()).toHaveLength(0)
    })

    /**
     * Under the deck.gl engine MMGIS still builds `data`, `image`, `video`
     * and `velocity` layers as native Leaflet objects — ENGINE_LAYER_SUPPORT
     * has no deck builder for them — and L_.setLayerOpacity hands every
     * registry entry to the active engine without inspecting its shape. So a
     * Leaflet object does reach this adapter, and must not blow it up.
     */
    describe('given a native Leaflet layer', () => {
        test('is a no-op passed by object, and does not throw', () => {
            const adapter = new DeckGLAdapter()
            const velocity = makeTileish()

            expect(adapter.setLayerOpacity(velocity, 0.3)).toBeUndefined()
            // Not dimmed here: a Leaflet object carries no deck `id`, so the
            // engine never held it. L_.layers.opacity keeps the value.
            expect(velocity.opacity).toBe(null)
            expect(adapter.getLayers()).toHaveLength(0)
        })

        test('is a no-op even once the engine holds one, and does not throw', () => {
            const adapter = new DeckGLAdapter()
            const velocity = makeTileish()
            // addLayer keys off layer.id, which a Leaflet object lacks, so the
            // entry lands under `undefined`. Reproduced rather than endorsed —
            // what this pins is that reaching such an entry cannot throw
            // `existing.clone is not a function`.
            adapter.addLayer(velocity)

            expect(adapter.setLayerOpacity(velocity, 0.3)).toBeUndefined()
            expect(velocity.opacity).toBe(null)
            expect(() =>
                adapter.updateLayer(velocity, { opacity: 0.3 })
            ).not.toThrow()
        })
    })

    // deck.gl has no separate fill channel at this level — a single `opacity`
    // prop covers stroke and fill together — so options.fillOpacity is
    // subsumed by `opacity` rather than applied on its own. Pinned so a future
    // change that starts honouring it separately has to update this test
    // rather than slip through silently. (Nothing here pins the parameter's
    // declaration: JS does not enforce arity and vitest does not typecheck.)
    test('subsumes a given fillOpacity into opacity, writing no separate fill prop', () => {
        const adapter = new DeckGLAdapter()
        adapter.addLayer(makeDeckLayer('l1', { opacity: 1 }))

        expect(
            adapter.setLayerOpacity('l1', 0.5, { fillOpacity: 0.1 })
        ).toBeUndefined()

        const held = adapter.getLayers().find((l) => l.id === 'l1')
        expect(held.props.opacity).toBe(0.5)
        expect(held.props.fillOpacity).toBeUndefined()
    })
})
