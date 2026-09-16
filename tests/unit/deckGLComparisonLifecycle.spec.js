import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * What survives turning comparison on and off again.
 *
 * Comparison alone empties the primary surface and fills it back up, which puts
 * it on two paths nothing else walks: re-mounting a finalized deck.gl instance,
 * and moving the camera while the primary is not the surface being looked at.
 * Both fail silently, so both are pinned here.
 */

let container

/** A stand-in deck layer whose `clone` yields a fresh object, as deck.gl's does. */
const fakeLayer = (id) => {
    const make = () => ({ id, clone: () => make() })
    return make()
}

/** Records every layer array the primary surface is handed. */
const makeOverlay = () => ({
    props: { layers: [] },
    received: [],
    setProps(props) {
        Object.assign(this.props, props)
        if (props.layers) this.received.push(props.layers)
    },
})

const makeOverlayAdapter = () => {
    const adapter = new DeckGLAdapter()
    Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
    adapter._container = container
    adapter._isOverlayMode = true
    adapter._viewState = { longitude: -95, latitude: 38, zoom: 4, bearing: 0, pitch: 0 }
    adapter._overlay = makeOverlay()
    return adapter
}

beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    }
})

afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
})

test.describe('the primary surface never re-mounts a layer instance', () => {
    test('a sync hands deck.gl a copy, not the registry instance', () => {
        const adapter = makeOverlayAdapter()
        const stored = fakeLayer('co2')
        adapter.addLayer(stored)

        const sent = adapter._overlay.props.layers
        expect(sent.map((l) => l.id)).toEqual(['co2'])
        // A registry instance that gets mounted can only ever be mounted once.
        expect(sent[0]).not.toBe(stored)
    })

    test('an enable/disable cycle re-mounts nothing that was already dropped', () => {
        const adapter = makeOverlayAdapter()
        adapter.addLayer(fakeLayer('co2'))
        adapter.addLayer(fakeLayer('ch4'))
        const beforeComparison = adapter._overlay.props.layers

        adapter.enableComparison({ leftLayerIds: ['co2'], rightLayerIds: ['ch4'] })
        expect(adapter._overlay.props.layers).toEqual([])

        adapter.disableComparison()

        const restored = adapter._overlay.props.layers
        expect(restored.map((l) => l.id)).toEqual(['co2', 'ch4'])
        // Emptying the array finalized those instances; handing one back is
        // the silent-failure path.
        for (const layer of restored) {
            expect(beforeComparison).not.toContain(layer)
        }
    })

    test('every sync is a fresh set, so no instance is mounted twice', () => {
        const adapter = makeOverlayAdapter()
        adapter.addLayer(fakeLayer('co2'))
        adapter.enableComparison({ leftLayerIds: ['co2'], rightLayerIds: [] })
        adapter.disableComparison()
        adapter.enableComparison({ leftLayerIds: ['co2'], rightLayerIds: [] })
        adapter.disableComparison()

        const mounted = adapter._overlay.received.flat()
        expect(mounted.length).toBeGreaterThan(1)
        expect(new Set(mounted).size).toBe(mounted.length)
    })
})

test.describe('programmatic camera moves reach the comparison surfaces', () => {
    /** Standalone mode: no basemap, so the side canvases are the whole scene. */
    const makeStandaloneAdapter = () => {
        const adapter = new DeckGLAdapter()
        Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
        adapter._container = container
        adapter._isOverlayMode = false
        adapter._viewState = { longitude: -95, latitude: 38, zoom: 4, bearing: 0, pitch: 0 }
        adapter._deck = { setProps: vi.fn(), redraw: vi.fn(), finalize: vi.fn() }
        return adapter
    }

    test('setView moves the swipe canvases, not just the primary', () => {
        const adapter = makeStandaloneAdapter()
        adapter.enableComparison({ leftLayerIds: [], rightLayerIds: [] })
        const sync = vi.spyOn(adapter, '_syncComparisonCamera')

        adapter.setView({ lat: 10, lng: 20 }, 6)

        expect(sync).toHaveBeenCalled()
        expect(adapter._viewState.longitude).toBe(20)
        expect(adapter._viewState.latitude).toBe(10)
    })

    test('the canvases are given the view state the primary was given', () => {
        const adapter = makeStandaloneAdapter()
        adapter.enableComparison({ leftLayerIds: [], rightLayerIds: [] })
        const left = { setProps: vi.fn() }
        const right = { setProps: vi.fn() }
        adapter._comparisonLeftDeck = left
        adapter._comparisonRightDeck = right

        adapter.setView({ lat: 10, lng: 20 }, 6)

        for (const deck of [left, right]) {
            const viewState = deck.setProps.mock.calls.at(-1)[0].viewState
            expect(viewState.longitude).toBe(20)
            expect(viewState.zoom).toBe(6)
        }
    })
})
