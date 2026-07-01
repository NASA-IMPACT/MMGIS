import { test, expect, vi, beforeEach } from 'vitest'

// Issue #143 - the deck.gl screenshot path depends on the GL context being
// created with `preserveDrawingBuffer: true`; without it, canvas.toDataURL()
// returns a blank image. The captureScreenshot() tests inject fake
// _basemap/_deck and never call init(), so nothing guards that init() actually
// requests that setting. These tests drive the real init() path with the GL
// constructors mocked, and assert the setting is passed through on both the
// standalone (Deck) and overlay (maplibre Map) paths.
//
// Regression guard specifically for the deck.gl v9 shape: the setting lives at
// deviceProps.webgl.preserveDrawingBuffer on Deck (the v8 `glOptions` prop no
// longer exists in v9), and preserveDrawingBuffer at the top level of the
// maplibre/mapbox Map constructor options.

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

test.describe('DeckGLAdapter init sets preserveDrawingBuffer (issue #143)', () => {
    beforeEach(() => {
        deckCtorArgs.length = 0
        maplibreCtorArgs.length = 0
        makeContainer('map')
    })

    test('standalone mode creates the Deck with deviceProps.webgl.preserveDrawingBuffer', () => {
        const adapter = new DeckGLAdapter()
        adapter.init({ containerId: 'map', zoom: 4, center: { lat: 0, lng: 0 } })

        expect(deckCtorArgs).toHaveLength(1)
        expect(deckCtorArgs[0].deviceProps.webgl.preserveDrawingBuffer).toBe(true)
    })

    test('maplibre overlay mode creates the Map with preserveDrawingBuffer', () => {
        const adapter = new DeckGLAdapter()
        adapter.init({
            containerId: 'map',
            zoom: 4,
            center: { lat: 0, lng: 0 },
            basemap: { provider: 'maplibre', style: 'https://example/style.json' },
        })

        expect(maplibreCtorArgs).toHaveLength(1)
        expect(maplibreCtorArgs[0].preserveDrawingBuffer).toBe(true)
    })
})
