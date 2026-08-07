import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'
import { supportsCogTransform } from '../../src/essence/Basics/Layers_/tileUrlUtils.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// provider under test never touches Map_, so a bare stub keeps the graph
// loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getColormapCapable` is how a plugin learns which layers accept a
 * colormap or rescale change. It answers for every layer type on every engine,
 * so plugins never test config `type` themselves — the mapping from a deck.gl
 * class name to a canonical type lives in core alone.
 */

const cogLayer = (type) => ({ type, cogTransform: true, cogColormap: 'viridis' })

describe('supportsCogTransform', () => {
    // TileLayer and BitmapLayer are how a deck.gl mission configures the
    // raster layers a Leaflet mission types `tile`.
    test.each([['tile'], ['TileLayer'], ['BitmapLayer']])(
        'accepts a %s layer with cogTransform',
        (type) => {
            expect(supportsCogTransform(cogLayer(type))).toBe(true)
        }
    )

    // An `image` layer honours cogTransform too, but colours its pixels
    // client-side; layers:refresh has no path that repaints one.
    test.each([['image'], ['vector'], ['GeoJsonLayer'], ['vectortile'], ['MVTLayer']])(
        'rejects a %s layer even with cogTransform set',
        (type) => {
            expect(supportsCogTransform(cogLayer(type))).toBe(false)
        }
    )

    test('rejects a raster layer that is not COG-transformed', () => {
        expect(supportsCogTransform({ type: 'tile' })).toBe(false)
        expect(supportsCogTransform({ type: 'tile', cogTransform: false })).toBe(false)
    })

    test('rejects a layer with no type and a missing layer', () => {
        expect(supportsCogTransform({ cogTransform: true })).toBe(false)
        expect(supportsCogTransform(null)).toBe(false)
        expect(supportsCogTransform(undefined)).toBe(false)
    })
})

describe('layers:getColormapCapable provider', () => {
    let providers

    afterAll(() => {
        delete window.mmgisAPI
        L_.layers.data = {}
    })

    beforeEach(() => {
        L_.layers.data = {}
        providers = {}
        window.mmgisAPI = {
            provide: (name, fn) => {
                providers[name] = fn
                return () => {}
            },
        }
        L_.fina(null, null, null, null, null, null)
    })

    test('reports a flag for every layer, keyed by uuid', () => {
        L_.layers.data = {
            Displacement: cogLayer('TileLayer'),
            Basemap: { type: 'TileLayer' },
            Boundaries: cogLayer('GeoJsonLayer'),
        }

        expect(providers['layers:getColormapCapable']()).toEqual({
            Displacement: true,
            Basemap: false,
            Boundaries: false,
        })
    })

    test('returns an empty map before any layer loads', () => {
        expect(providers['layers:getColormapCapable']()).toEqual({})
    })
})
