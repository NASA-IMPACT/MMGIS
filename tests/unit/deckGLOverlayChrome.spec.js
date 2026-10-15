import { test, expect, vi, beforeEach } from 'vitest'

// What the deck.gl engine's overlay mode tells the layout and a live scale
// bar: the 'move' stream while the camera moves, and how far the basemap's
// logo and attribution reach up from the bottom. The GL constructors are
// mocked (jsdom has no WebGL); the basemap mock holds a settable camera.

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
        constructor(opts) {
            this.handlers = {}
            // MapLibre builds its control corners with the map.
            for (const side of ['left', 'right']) {
                const corner = document.createElement('div')
                corner.className = `maplibregl-ctrl-bottom-${side}`
                opts.container.appendChild(corner)
            }
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
const { NO_CHROME_INSETS } = await import('../../src/essence/Basics/MapEngines/IMapEngine.ts')

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

const standalone = (center, zoom) => {
    const adapter = new DeckGLAdapter()
    adapter.init({ containerId: 'map', zoom, center })
    return adapter
}

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

test.describe('DeckGLAdapter basemap chrome', () => {
    // A ResizeObserver that runs its callback on demand, standing in for the
    // browser's (jsdom has none).
    let observers
    beforeEach(() => {
        observers = []
        globalThis.ResizeObserver = class {
            constructor(cb) {
                this.cb = cb
                this.targets = []
                observers.push(this)
            }
            observe(el) {
                this.targets.push(el)
            }
            disconnect() {
                this.targets = []
            }
        }
    })

    const rect = (el, top, bottom, left = 0, right = 800) => {
        el.getBoundingClientRect = () => ({ top, bottom, left, right, height: bottom - top })
    }

    test('reports how far the logo and attribution reach up from the bottom', () => {
        const container = makeContainer()
        container.innerHTML = ''
        const { adapter } = overlay()
        rect(container, 0, 600)
        const left = container.querySelector('.maplibregl-ctrl-bottom-left')
        const right = container.querySelector('.maplibregl-ctrl-bottom-right')
        expect(observers[0].targets).toEqual([left, right])

        const changes = []
        adapter.on('chromeinsetschange', (e) => changes.push(e))
        rect(left, 569, 600, 0, 97.5)
        rect(right, 578.5, 600, 580, 800)
        observers[0].cb()
        const insets = { bottomLeft: 31, bottomRight: 22, bottomLeftWidth: 98, bottomRightWidth: 220 }
        expect(adapter.getChromeInsets()).toEqual(insets)
        expect(changes).toEqual([insets])

        // A resize that leaves the rounded reach unchanged is not announced.
        rect(left, 569.2, 600, 0, 97.6)
        observers[0].cb()
        expect(changes).toHaveLength(1)
    })

    test('an empty corner reaches nowhere', () => {
        const container = makeContainer()
        container.innerHTML = ''
        const { adapter } = overlay()
        rect(container, 0, 600)
        rect(container.querySelector('.maplibregl-ctrl-bottom-left'), 600, 600)
        rect(container.querySelector('.maplibregl-ctrl-bottom-right'), 600, 600)
        observers[0].cb()
        expect(adapter.getChromeInsets()).toEqual(NO_CHROME_INSETS)
    })

    test('standalone mode has no basemap chrome', () => {
        expect(standalone({ lat: 0, lng: 0 }, 2).getChromeInsets()).toEqual(NO_CHROME_INSETS)
        expect(observers).toHaveLength(0)
    })
})
