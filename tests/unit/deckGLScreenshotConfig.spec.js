import { test, expect, vi, beforeEach } from 'vitest'

// Issue #143 - the deck.gl screenshot path captures on demand instead of
// paying the per-frame cost of `preserveDrawingBuffer: true`:
// - overlay mode reads the canvas inside a once('render') handler after
//   triggerRepaint(), in the same frame the map draws (before the browser
//   presents and clears the buffer);
// - standalone mode reads immediately after deck.redraw('screenshot'), which
//   draws synchronously in deck.gl v9.
// Nothing should request preserveDrawingBuffer at init time any more. These
// tests drive the real init() path with the GL constructors mocked and assert
// the flag is absent on both the standalone (Deck) and overlay (maplibre Map)
// paths — a regression guard against reintroducing the always-on buffer copy.

const deckCtorArgs = []
const maplibreCtorArgs = []

vi.mock('@deck.gl/core', async (importOriginal) => {
    // Keep the real interpolators etc.; only the Deck constructor is replaced so
    // no real WebGL context is created (jsdom has none).
    const actual = await importOriginal()
    class MockDeck {
        constructor(props) {
            deckCtorArgs.push(props)
        }
        setProps() {}
        redraw() {}
        finalize() {}
        getCanvas() {
            return { toDataURL: () => 'data:image/png;base64,MOCK' }
        }
    }
    return { ...actual, Deck: MockDeck }
})

vi.mock('maplibre-gl', () => {
    class MockMap {
        constructor(opts) {
            maplibreCtorArgs.push(opts)
        }
        addControl() {}
        on() {}
        once() {}
        off() {}
        setMaxBounds() {}
        remove() {}
        getCanvas() {
            return { toDataURL: () => 'data:image/png;base64,MOCK' }
        }
    }
    return { Map: MockMap, default: { Map: MockMap } }
})

// Imported after the mocks are declared (vi.mock is hoisted regardless).
const { DeckGLAdapter } = await import(
    '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'
)

function makeContainer(id = 'map') {
    let el = document.getElementById(id)
    if (!el) {
        el = document.createElement('div')
        el.id = id
        document.body.appendChild(el)
    }
    return el
}

test.describe('DeckGLAdapter init does not set preserveDrawingBuffer (issue #143)', () => {
    beforeEach(() => {
        deckCtorArgs.length = 0
        maplibreCtorArgs.length = 0
        makeContainer('map')
    })

    test('standalone mode creates the Deck without preserveDrawingBuffer deviceProps', () => {
        const adapter = new DeckGLAdapter()
        adapter.init({ containerId: 'map', zoom: 4, center: { lat: 0, lng: 0 } })

        expect(deckCtorArgs).toHaveLength(1)
        expect(deckCtorArgs[0].deviceProps?.webgl?.preserveDrawingBuffer).toBeUndefined()
    })

    test('maplibre overlay mode creates the Map without preserveDrawingBuffer', () => {
        const adapter = new DeckGLAdapter()
        adapter.init({
            containerId: 'map',
            zoom: 4,
            center: { lat: 0, lng: 0 },
            basemap: { provider: 'maplibre', style: 'https://example/style.json' },
        })

        expect(maplibreCtorArgs).toHaveLength(1)
        expect(maplibreCtorArgs[0].preserveDrawingBuffer).toBeUndefined()
    })
})
