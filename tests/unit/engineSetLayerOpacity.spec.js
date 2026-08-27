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

    // deck.gl has no separate fill channel at this level — a single `opacity`
    // prop covers stroke and fill together — so options.fillOpacity is
    // accepted (matching IMapEngine's signature) but subsumed by `opacity`
    // rather than applied on its own. Pinned so a future change that starts
    // honouring it separately has to update this test rather than slip
    // through silently.
    test('accepts a third argument and still applies opacity, not a separate fill value', () => {
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
