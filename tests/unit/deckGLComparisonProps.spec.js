import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * Comparison draws each side by cloning the live deck layers, which makes both
 * sides identical unless the caller supplies per-side prop overrides. These
 * cases cover that hand-off: that a side's overrides reach only that side, that
 * an unlisted layer is cloned untouched, and that the sides keep redrawing as
 * the layer registry changes underneath them.
 *
 * The adapter is driven against fake layers and fake side canvases — a real
 * `Deck` needs WebGL, which jsdom has none of. Everything under test here is
 * bookkeeping above the canvas: which clone carries which props, and when the
 * clones are recomputed.
 */

let container

/**
 * A stand-in for a deck layer. `clone` is the only part the comparison path
 * uses, and it behaves as deck.gl's does: a new instance carrying the original
 * props with the overrides applied over them.
 */
const fakeLayer = (id, props = {}) => ({
    id,
    props,
    clone(overrides = {}) {
        return fakeLayer(id, { ...props, ...overrides })
    },
})

/** A stand-in for a side canvas, recording what it was last asked to draw. */
const fakeDeck = () => ({
    props: { layers: [] },
    setProps(next) { Object.assign(this.props, next) },
    finalize() {},
})

/**
 * An adapter in overlay mode whose side canvases are fakes. The primary
 * overlay is left unset, so pushing layers to it is a no-op — this spec is
 * about the side surfaces.
 */
const makeAdapter = () => {
    const adapter = new DeckGLAdapter()
    adapter._container = container
    adapter._isOverlayMode = true
    adapter._viewState = { longitude: 0, latitude: 0, zoom: 2, bearing: 0, pitch: 0 }
    adapter._createComparisonCanvases = function () {
        this._comparisonLeftDeck = fakeDeck()
        this._comparisonRightDeck = fakeDeck()
        this._comparisonLeftDiv = document.createElement('div')
        this._comparisonRightDiv = document.createElement('div')
    }
    adapter._syncComparisonCamera = () => {}
    return adapter
}

/**
 * A stand-in for one half of the side-by-side layout. Only `overlay` and `div`
 * are exercised: the former is what a pane's layers are pushed to in overlay
 * mode, the latter is what the divider sizes.
 */
const fakePane = () => ({
    div: document.createElement('div'),
    mapDiv: null,
    map: null,
    overlay: fakeDeck(),
    deck: null,
    offMap: () => {},
})

/** The layers each side was last rendered with. */
const rendered = (adapter) => ({
    left: adapter._comparisonLeftDeck?.props?.layers ?? [],
    right: adapter._comparisonRightDeck?.props?.layers ?? [],
})

beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
})

afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
})

describe('comparison prop overrides', () => {
    test('a side draws its own layer with its own props', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))

        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
            leftLayerProps: { co2: { data: 'https://host/JAN' } },
            rightLayerProps: { co2: { data: 'https://host/JUN' } },
        })

        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/JAN')
        expect(right[0].props.data).toBe('https://host/JUN')
    })

    test('a layer with no override for a side is cloned unchanged', () => {
        const adapter = makeAdapter()
        adapter._layers.set('roads', fakeLayer('roads', { data: 'https://host/roads' }))

        adapter.enableComparison({
            leftLayerIds: ['roads'],
            rightLayerIds: ['roads'],
            layout: 'swipe',
            leftLayerProps: {},
            rightLayerProps: { other: { data: 'https://host/nope' } },
        })

        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/roads')
        expect(right[0].props.data).toBe('https://host/roads')
    })

    test('an id with no live layer is skipped rather than drawn empty', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))

        adapter.enableComparison({
            leftLayerIds: ['co2', 'notloaded'],
            rightLayerIds: ['co2', 'notloaded'],
            layout: 'swipe',
        })

        expect(rendered(adapter).left).toHaveLength(1)
    })

    test('the sides redraw when the layer registry changes', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))
        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
        })

        adapter.updateLayer('co2', { url: 'https://host/b' })

        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/b')
        expect(right[0].props.data).toBe('https://host/b')
    })

    test('a pinned side holds its props when the registry layer moves', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))
        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
            leftLayerProps: { co2: { data: 'https://host/JAN' } },
        })

        adapter.updateLayer('co2', { url: 'https://host/b' })

        // An override outranks the layer's own props, so the side that pinned a
        // source stays on it while the side that did not follows the registry.
        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/JAN')
        expect(right[0].props.data).toBe('https://host/b')
    })

    test('the side-by-side panes draw with the overrides too', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))
        // Real panes each build a basemap, which jsdom cannot stand up; what
        // matters here is which layers reach a pane's surface.
        adapter._createSideBySidePanes = function () {
            this._sbsPanes = [fakePane(), fakePane()]
        }

        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'sideBySide',
            leftLayerProps: { co2: { data: 'https://host/JAN' } },
            rightLayerProps: { co2: { data: 'https://host/JUN' } },
        })

        const [leftPane, rightPane] = adapter._sbsPanes
        expect(leftPane.overlay.props.layers[0].props.data).toBe('https://host/JAN')
        expect(rightPane.overlay.props.layers[0].props.data).toBe('https://host/JUN')
    })

    test('a pinned side holds its props when the registry layer is rebuilt', () => {
        const adapter = makeAdapter()
        adapter._layers.set('mvt', fakeLayer('mvt', { data: 'https://host/{endtime}/{z}/{x}/{y}.pbf' }))
        adapter.enableComparison({
            leftLayerIds: ['mvt'],
            rightLayerIds: ['mvt'],
            layout: 'swipe',
            leftLayerProps: { mvt: { data: 'https://host/JAN/{z}/{x}/{y}.pbf' } },
        })

        // A time change on a vector tile layer rebuilds it from scratch and
        // re-registers the new instance, rather than editing the old one in
        // place. The pinned side must still outrank whatever instance the
        // registry currently holds.
        adapter.addLayer(fakeLayer('mvt', { data: 'https://host/JUN/{z}/{x}/{y}.pbf' }))

        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/JAN/{z}/{x}/{y}.pbf')
        expect(right[0].props.data).toBe('https://host/JUN/{z}/{x}/{y}.pbf')
    })

    test('overrides survive a layout switch', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))
        adapter._createSideBySidePanes = function () {
            this._sbsPanes = [fakePane(), fakePane()]
        }
        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
            leftLayerProps: { co2: { data: 'https://host/JAN' } },
            rightLayerProps: { co2: { data: 'https://host/JUN' } },
        })

        adapter.setComparisonLayout('sideBySide')
        adapter.setComparisonLayout('swipe')

        // A switch rebuilds the surfaces around the layer sets already in
        // place, so what each side draws survives the round trip.
        expect(adapter.getComparisonLayout()).toBe('swipe')
        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/JAN')
        expect(right[0].props.data).toBe('https://host/JUN')
    })

    test('overrides do not carry into the next comparison', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', fakeLayer('co2', { data: 'https://host/a' }))
        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
            leftLayerProps: { co2: { data: 'https://host/JAN' } },
        })

        adapter.disableComparison()
        adapter.enableComparison({
            leftLayerIds: ['co2'],
            rightLayerIds: ['co2'],
            layout: 'swipe',
        })

        const { left, right } = rendered(adapter)
        expect(left[0].props.data).toBe('https://host/a')
        expect(right[0].props.data).toBe('https://host/a')
    })
})
