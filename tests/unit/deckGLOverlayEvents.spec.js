import { test, expect, vi, beforeEach } from 'vitest'

// The deck.gl engine reports the 'move' stream while the camera moves, with
// or without a basemap. The GL constructors are mocked (jsdom has no WebGL); the
// basemap mock holds a settable camera.

const basemaps = []

vi.mock('@deck.gl/core', async (importOriginal) => {
    const actual = await importOriginal()
    class MockDeck {
        constructor(props) {
            this.props = props
            this.canvas = makeCanvas()
        }
        setProps() {}
        redraw() {}
        finalize() {}
        getCanvas() {
            return this.canvas
        }
    }
    return { ...actual, Deck: MockDeck }
})

vi.mock('maplibre-gl', () => {
    class MockMap {
        constructor() {
            this.handlers = {}
            this.center = { lat: 0, lng: 0 }
            this.zoom = 0
            this.canvas = makeCanvas()
            basemaps.push(this)
        }
        addControl() {}
        on(event, handler) {
            ;(this.handlers[event] ||= []).push(handler)
        }
        once(event, handler) {
            this.on(event, handler)
        }
        off() {}
        fire(event) {
            for (const h of this.handlers[event] || []) h()
        }
        triggerRepaint() {
            const pending = this.handlers.render || []
            this.handlers.render = []
            for (const h of pending) h()
        }
        setMaxBounds() {}
        remove() {}
        getCenter() {
            return this.center
        }
        getZoom() {
            return this.zoom
        }
        getBearing() {
            return 0
        }
        getPitch() {
            return 0
        }
        getCanvas() {
            return this.canvas
        }
    }
    class MockPopup {}
    return {
        Map: MockMap,
        Popup: MockPopup,
        default: { Map: MockMap, Popup: MockPopup },
    }
})

function makeCanvas() {
    return {
        width: 800,
        height: 400,
        toBlob: (cb) => cb(new Blob(['png'], { type: 'image/png' })),
    }
}

const { DeckGLAdapter } = await import(
    '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'
)

function makeContainer() {
    let el = document.getElementById('map')
    if (!el) {
        el = document.createElement('div')
        el.id = 'map'
        document.body.appendChild(el)
    }
    return el
}

beforeEach(() => {
    basemaps.length = 0
    makeContainer()
})

const overlay = () => {
    const adapter = new DeckGLAdapter()
    adapter.init({
        containerId: 'map',
        zoom: 0,
        center: { lat: 0, lng: 0 },
        basemap: { provider: 'maplibre', style: 'https://example/style.json' },
    })
    return { adapter, basemap: basemaps[0] }
}

test.describe('DeckGLAdapter overlay move events', () => {
    // A live scale bar follows the camera while it moves, not only when the
    // gesture ends.
    test("each basemap move reaches the engine's 'move' listeners", () => {
        const { adapter, basemap } = overlay()
        const moves = []
        adapter.on('move', (e) => moves.push(e))
        basemap.center = { lat: 10, lng: 20 }
        basemap.zoom = 7
        basemap.fire('move')
        expect(moves).toHaveLength(1)
        expect(moves[0]).toMatchObject({ latitude: 10, longitude: 20, zoom: 7 })
    })
})

test.describe('DeckGLAdapter standalone move events', () => {
    test("each camera change reaches 'move' as well as 'moveend'", () => {
        const adapter = new DeckGLAdapter()
        adapter.init({ containerId: 'map', zoom: 0, center: { lat: 0, lng: 0 } })
        const moves = []
        adapter.on('move', (e) => moves.push(e))
        adapter
            .getNativeMap()
            .props.onViewStateChange({
                viewState: { latitude: 3, longitude: 4, zoom: 2, bearing: 0, pitch: 0 },
            })
        expect(moves).toHaveLength(1)
        expect(moves[0]).toMatchObject({ latitude: 3, longitude: 4, zoom: 2 })
    })
})

test.describe('DeckGLAdapter unprojection', () => {
    const sized = (el, w, h) => {
        Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
        Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
    }

    // Successive unprojections share one viewport, which has to follow the
    // camera and the container size rather than answer for a stale view.
    test('follows camera and container changes', () => {
        const el = makeContainer()
        sized(el, 800, 400)
        const adapter = new DeckGLAdapter()
        adapter.init({ containerId: 'map', zoom: 2, center: { lat: 0, lng: 0 } })
        const at = { x: 400, y: 200 }
        expect(adapter.containerPointToLatLng(at).lng).toBeCloseTo(0, 6)

        adapter.getNativeMap().props.onViewStateChange({
            viewState: { latitude: 0, longitude: 30, zoom: 2, bearing: 0, pitch: 0 },
        })
        expect(adapter.containerPointToLatLng(at).lng).toBeCloseTo(30, 6)

        sized(el, 1200, 400)
        expect(adapter.containerPointToLatLng(at).lng).toBeLessThan(30)
        sized(el, 0, 0)
    })
})

test.describe('DeckGLAdapter pointer events', () => {
    // A scale bar measuring under the pointer returns to the map centre once
    // the pointer leaves, as it does on Leaflet's 'mouseout'.
    test("the pointer leaving the map reaches 'mouseout' until destroy", () => {
        const el = makeContainer()
        const adapter = new DeckGLAdapter()
        adapter.init({ containerId: 'map', zoom: 0, center: { lat: 0, lng: 0 } })
        const outs = vi.fn()
        adapter.on('mouseout', outs)
        el.dispatchEvent(new MouseEvent('mouseleave'))
        expect(outs).toHaveBeenCalledTimes(1)
        adapter.destroy()
        el.dispatchEvent(new MouseEvent('mouseleave'))
        expect(outs).toHaveBeenCalledTimes(1)
    })
})
