import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
    cogSourceType,
    hasCogColormap,
    supportsCogTransform,
} from '../../src/essence/Basics/Layers_/tileUrlUtils.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// provider under test never touches Map_, so a bare stub keeps the graph
// loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getCogCapabilities` is how a plugin learns what a layer's COG
 * colormap supports. It answers two things separately — whether there is a
 * ramp to draw, and whether that ramp can be changed — because an `image`
 * layer has the first without the second.
 *
 * It answers for every layer type on every engine, so plugins never test
 * config `type` themselves: the mapping from a deck.gl class name to a
 * canonical type lives in core alone.
 */

const COG_URL = 'COG:/path/to/raster.tif'

const cogLayer = (type, url = COG_URL) => ({
    type,
    cogTransform: true,
    cogColormap: 'viridis',
    url,
})

describe('cogSourceType', () => {
    test.each([
        ['stac-collection:my-collection', 'stac-collection'],
        ['COG:/path/to/raster.tif', 'COG'],
        ['titiler-url:https://titiler.example.com/tiles', 'titiler-url'],
    ])('recognises %s', (url, expected) => {
        expect(cogSourceType(url)).toBe(expected)
    })

    test('returns undefined for a plain tile template', () => {
        expect(cogSourceType('https://host/{z}/{x}/{y}.png')).toBeUndefined()
        expect(cogSourceType('tiles/{z}/{x}/{y}.png')).toBeUndefined()
    })

    // A prefix with nothing after the colon names no source.
    test('returns undefined for a bare prefix and for nothing', () => {
        expect(cogSourceType('COG')).toBeUndefined()
        expect(cogSourceType('')).toBeUndefined()
        expect(cogSourceType(null)).toBeUndefined()
        expect(cogSourceType(undefined)).toBeUndefined()
    })
})

describe('hasCogColormap', () => {
    // TileLayer and BitmapLayer are how a deck.gl mission configures the
    // raster layers a Leaflet mission types `tile`. An `image` layer colours
    // its pixels from the same cog* fields.
    test.each([['tile'], ['TileLayer'], ['BitmapLayer'], ['image']])(
        'accepts a %s layer with cogTransform',
        (type) => {
            expect(hasCogColormap(cogLayer(type))).toBe(true)
        }
    )

    test.each([['vector'], ['GeoJsonLayer'], ['vectortile'], ['MVTLayer']])(
        'rejects a %s layer even with cogTransform set',
        (type) => {
            expect(hasCogColormap(cogLayer(type))).toBe(false)
        }
    )

    test('rejects a layer that is not COG-transformed', () => {
        expect(hasCogColormap({ type: 'tile' })).toBe(false)
        expect(hasCogColormap({ type: 'tile', cogTransform: false })).toBe(false)
    })

    test('rejects a layer with no type and a missing layer', () => {
        expect(hasCogColormap({ cogTransform: true })).toBe(false)
        expect(hasCogColormap(null)).toBe(false)
        expect(hasCogColormap(undefined)).toBe(false)
    })
})

describe('supportsCogTransform', () => {
    test.each([['tile'], ['TileLayer'], ['BitmapLayer']])(
        'accepts a %s layer served from a COG source',
        (type) => {
            expect(supportsCogTransform(cogLayer(type), COG_URL)).toBe(true)
        }
    )

    // An image layer bakes its colormap in at construction; no refresh path
    // repaints one, so it shows its ramp without offering to change it.
    test('rejects an image layer that has a colormap to show', () => {
        const layer = cogLayer('image')
        expect(hasCogColormap(layer)).toBe(true)
        expect(supportsCogTransform(layer, COG_URL)).toBe(false)
    })

    // Nothing injects COG params into a plain tile template, so a change
    // would recompile a byte-identical URL and move nothing on the map.
    test('rejects a raster layer served from a plain tile template', () => {
        const url = 'https://host/{z}/{x}/{y}.png'
        const layer = cogLayer('TileLayer', url)
        expect(hasCogColormap(layer)).toBe(true)
        expect(supportsCogTransform(layer, url)).toBe(false)
    })

    test.each([
        ['stac-collection:my-collection'],
        ['titiler-url:https://titiler.example.com/tiles'],
    ])('accepts a raster layer served from %s', (url) => {
        expect(supportsCogTransform(cogLayer('TileLayer', url), url)).toBe(true)
    })

    test('rejects a raster layer that is not COG-transformed', () => {
        expect(supportsCogTransform({ type: 'tile', url: COG_URL }, COG_URL)).toBe(false)
    })
})

describe('layers:getCogCapabilities provider', () => {
    let providers

    // A layer's UUID is not its display name, and the capability map is keyed
    // by UUID. Named distinctly so a lookup by the wrong key finds nothing.
    const DISPLACEMENT = 'Displacement_0123456789abcdef'
    const BASEMAP = 'Basemap_fedcba9876543210'
    const BOUNDARIES = 'Boundaries_0f1e2d3c4b5a6978'

    afterAll(() => {
        delete window.mmgisAPI
        L_.layers.data = {}
        L_.layers.nameToUUID = {}
    })

    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.nameToUUID = {}
        providers = {}
        window.mmgisAPI = {
            provide: (name, fn) => {
                providers[name] = fn
                return () => {}
            },
        }
        L_.fina(null, null, null, null, null, null)
    })

    const loadLayers = () => {
        L_.layers.data = {
            [DISPLACEMENT]: { ...cogLayer('TileLayer'), display_name: 'Displacement' },
            [BASEMAP]: { type: 'TileLayer', url: COG_URL, display_name: 'Basemap' },
            [BOUNDARIES]: { ...cogLayer('GeoJsonLayer'), display_name: 'Boundaries' },
        }
        L_.layers.nameToUUID = {
            Displacement: [DISPLACEMENT],
            Basemap: [BASEMAP],
            Boundaries: [BOUNDARIES],
        }
    }

    test('reports both verdicts for every layer, keyed by uuid', () => {
        loadLayers()

        expect(providers['layers:getCogCapabilities']()).toEqual({
            [DISPLACEMENT]: { hasColormap: true, canChangeColormap: true },
            [BASEMAP]: { hasColormap: false, canChangeColormap: false },
            [BOUNDARIES]: { hasColormap: false, canChangeColormap: false },
        })
    })

    test('reports an image layer as showable but not changeable', () => {
        const uuid = 'Elevation_9876543210fedcba'
        L_.layers.data = { [uuid]: cogLayer('image') }

        expect(providers['layers:getCogCapabilities']()).toEqual({
            [uuid]: { hasColormap: true, canChangeColormap: false },
        })
    })

    // Every other layer-keyed provider resolves a display name to its UUID;
    // a caller holding either identifier has to get the same answer.
    test('answers for a single layer by uuid or by display name', () => {
        loadLayers()
        const expected = { hasColormap: true, canChangeColormap: true }

        expect(providers['layers:getCogCapabilities'](DISPLACEMENT)).toEqual(expected)
        expect(providers['layers:getCogCapabilities']('Displacement')).toEqual(expected)
    })

    // A deckRaster layer renders client-side: its colormap changes by
    // rebuilding the layer, not by recompiling a tile URL, so a plain .tif
    // source (no COG:/stac prefix) must still report as changeable. The
    // verdict is engine-dependent — the same config in a Leaflet mission
    // renders through TiTiler and needs a recompilable URL.
    describe('a deckRaster layer with a plain .tif source', () => {
        const uuid = 'Cmip_a1b2c3d4e5f60718'
        const priorMap = L_.Map_

        const setEngine = (engineType) => {
            L_.Map_ = { engine: { engineType } }
            L_.layers.data = {
                [uuid]: {
                    type: 'tile',
                    cogTransform: true,
                    cogColormap: 'viridis',
                    cogRendererMode: 'deckRaster',
                    url: 'https://example.com/data/tasmax.tif',
                },
            }
        }

        afterEach(() => {
            L_.Map_ = priorMap
        })

        test('is changeable in a deck.gl mission', () => {
            setEngine('deckgl')
            expect(providers['layers:getCogCapabilities'](uuid)).toEqual({
                hasColormap: true,
                canChangeColormap: true,
            })
        })

        test('is not changeable in a leaflet mission', () => {
            setEngine('leaflet')
            expect(providers['layers:getCogCapabilities'](uuid)).toEqual({
                hasColormap: true,
                canChangeColormap: false,
            })
        })
    })

    test('answers null for a layer it has never heard of', () => {
        loadLayers()
        expect(providers['layers:getCogCapabilities']('NoSuchLayer')).toBeNull()
    })

    // A tile level overrides the layer's own url, so the verdict has to read
    // the level a layer is actually displaying.
    test('reads the active tile level url rather than the layer url', () => {
        const uuid = 'Levelled_1122334455667788'
        L_.layers.data = {
            [uuid]: {
                type: 'TileLayer',
                cogTransform: true,
                url: COG_URL,
                currentTileLevel: 'coarse',
                variables: {
                    tileLevels: [
                        { value: 'coarse', url: 'https://host/{z}/{x}/{y}.png' },
                        { value: 'fine', url: COG_URL },
                    ],
                },
            },
        }

        expect(providers['layers:getCogCapabilities'](uuid)).toEqual({
            hasColormap: true,
            canChangeColormap: false,
        })

        L_.layers.data[uuid].currentTileLevel = 'fine'
        expect(providers['layers:getCogCapabilities'](uuid)).toEqual({
            hasColormap: true,
            canChangeColormap: true,
        })
    })

    test('returns an empty map before any layer loads', () => {
        expect(providers['layers:getCogCapabilities']()).toEqual({})
    })
})
