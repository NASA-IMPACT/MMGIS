import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// provider under test reads only `L_.Map_.engine.engineType`, which the specs
// set directly, so a bare stub keeps the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getBounds` is how a plugin learns where a layer sits, so it can ask
 * the map to move there without touching a layer object itself.
 *
 * An extent comes from a different place depending on how the layer is drawn,
 * and the provider is what hides that from plugins: a Leaflet layer measures
 * its own geometry, a deck.gl layer has to be measured from the GeoJSON it
 * holds, and a raster layer only has the footprint mission configuration
 * declares for it.
 */

// A Leaflet LatLngBounds, as much of one as the provider reads.
const leafletBounds = (south, west, north, east, valid = true) => ({
    isValid: () => valid,
    getSouthWest: () => ({ lat: south, lng: west }),
    getNorthEast: () => ({ lat: north, lng: east }),
})

const leafletLayer = (bounds) => ({
    options: {},
    getBounds: () => bounds,
})

// isEngineOwnedLayer identifies a deck.gl layer by shape: deck's `props` and
// never Leaflet's `options`.
const deckLayer = (data) => ({ props: { data } })

const feature = (coordinates) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {},
})

describe('layers:getBounds provider', () => {
    let providers

    // A layer's UUID is not its display name, and the bounds map is keyed by
    // UUID. Named distinctly so a lookup by the wrong key finds nothing.
    const OUTLINE = 'Outline_0123456789abcdef'
    const IMAGERY = 'Imagery_fedcba9876543210'

    afterAll(() => {
        delete window.mmgisAPI
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.nameToUUID = {}
        L_.Map_ = null
    })

    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
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

    const getBounds = (...args) => providers['layers:getBounds'](...args)

    test('measures a Leaflet layer from its rendered geometry', () => {
        L_.layers.data = { [OUTLINE]: { type: 'vector' } }
        L_.layers.layer = {
            [OUTLINE]: leafletLayer(leafletBounds(-4, -8, 12, 16)),
        }

        expect(getBounds(OUTLINE)).toEqual([
            [-4, -8],
            [12, 16],
        ])
    })

    // A vector layer whose features have not arrived reports empty bounds.
    // That is not an extent, and the configured footprint is the better answer.
    test('falls past invalid Leaflet bounds to the configured footprint', () => {
        L_.layers.data = { [OUTLINE]: { boundingBox: [-8, -4, 16, 12] } }
        L_.layers.layer = {
            [OUTLINE]: leafletLayer(leafletBounds(0, 0, 0, 0, false)),
        }

        expect(getBounds(OUTLINE)).toEqual([
            [-4, -8],
            [12, 16],
        ])
    })

    test('falls past a throwing getBounds to the configured footprint', () => {
        L_.layers.data = { [OUTLINE]: { boundingBox: [-8, -4, 16, 12] } }
        L_.layers.layer = {
            [OUTLINE]: {
                options: {},
                getBounds: () => {
                    throw new Error('no geometry')
                },
            },
        }

        expect(getBounds(OUTLINE)).toEqual([
            [-4, -8],
            [12, 16],
        ])
    })

    describe('under a deck.gl engine', () => {
        beforeEach(() => {
            L_.Map_ = { engine: { engineType: 'deckgl' } }
        })

        test('measures a deck.gl layer from the GeoJSON it holds', () => {
            L_.layers.data = { [OUTLINE]: { type: 'GeoJsonLayer' } }
            L_.layers.layer = {
                [OUTLINE]: deckLayer({
                    type: 'FeatureCollection',
                    features: [feature([-8, -4]), feature([16, 12])],
                }),
            }

            expect(getBounds(OUTLINE)).toEqual([
                [-4, -8],
                [12, 16],
            ])
        })

        // Deck takes a bare array of features as readily as a collection.
        test('measures a deck.gl layer holding an array of features', () => {
            L_.layers.data = { [OUTLINE]: { type: 'GeoJsonLayer' } }
            L_.layers.layer = {
                [OUTLINE]: deckLayer([feature([-8, -4]), feature([16, 12])]),
            }

            expect(getBounds(OUTLINE)).toEqual([
                [-4, -8],
                [12, 16],
            ])
        })

        test('answers null for a deck.gl layer holding an empty array', () => {
            L_.layers.data = { [OUTLINE]: { type: 'GeoJsonLayer' } }
            L_.layers.layer = { [OUTLINE]: deckLayer([]) }

            expect(getBounds(OUTLINE)).toBeNull()
        })

        // Deck resolves a URL through its own loaders, so the features are not
        // here to measure.
        test('answers null for a deck.gl layer whose data is a url', () => {
            L_.layers.data = { [OUTLINE]: { type: 'GeoJsonLayer' } }
            L_.layers.layer = {
                [OUTLINE]: deckLayer('https://host/features.geojson'),
            }

            expect(getBounds(OUTLINE)).toBeNull()
        })

        // An empty collection measures to infinities, which would send the map
        // nowhere real.
        test('answers null for a deck.gl layer with no features', () => {
            L_.layers.data = { [OUTLINE]: { type: 'GeoJsonLayer' } }
            L_.layers.layer = {
                [OUTLINE]: deckLayer({
                    type: 'FeatureCollection',
                    features: [],
                }),
            }

            expect(getBounds(OUTLINE)).toBeNull()
        })
    })

    test('reads a configured footprint as [west, south, east, north]', () => {
        L_.layers.data = { [IMAGERY]: { boundingBox: [-120, 30, -100, 45] } }

        expect(getBounds(IMAGERY)).toEqual([
            [30, -120],
            [45, -100],
        ])
    })

    test('accepts a footprint written as strings', () => {
        L_.layers.data = { [IMAGERY]: { boundingBox: ['-120', '30', '-100', '45'] } }

        expect(getBounds(IMAGERY)).toEqual([
            [30, -120],
            [45, -100],
        ])
    })

    test.each([
        ['too short', [-120, 30, -100]],
        ['unparseable', [-120, 30, 'east', 45]],
        ['not an array', { west: -120 }],
    ])('answers null for a %s footprint', (_label, boundingBox) => {
        L_.layers.data = { [IMAGERY]: { boundingBox } }
        expect(getBounds(IMAGERY)).toBeNull()
    })

    test('answers null for a layer with nothing to measure', () => {
        L_.layers.data = { [IMAGERY]: { type: 'tile' } }
        expect(getBounds(IMAGERY)).toBeNull()
    })

    // Every other layer-keyed provider resolves a display name to its UUID;
    // a caller holding either identifier has to get the same answer.
    test('answers for a single layer by uuid or by display name', () => {
        L_.layers.data = {
            [IMAGERY]: { display_name: 'Imagery', boundingBox: [-120, 30, -100, 45] },
        }
        L_.layers.nameToUUID = { Imagery: [IMAGERY] }
        const expected = [
            [30, -120],
            [45, -100],
        ]

        expect(getBounds(IMAGERY)).toEqual(expected)
        expect(getBounds('Imagery')).toEqual(expected)
    })

    test('answers null for a layer it has never heard of', () => {
        L_.layers.data = { [IMAGERY]: { boundingBox: [-120, 30, -100, 45] } }
        expect(getBounds('NoSuchLayer')).toBeNull()
    })

    test('returns every layer keyed by uuid when asked for none', () => {
        L_.layers.data = {
            [OUTLINE]: { type: 'vector' },
            [IMAGERY]: { boundingBox: [-120, 30, -100, 45] },
        }
        L_.layers.layer = {
            [OUTLINE]: leafletLayer(leafletBounds(-4, -8, 12, 16)),
        }

        expect(getBounds()).toEqual({
            [OUTLINE]: [
                [-4, -8],
                [12, 16],
            ],
            [IMAGERY]: [
                [30, -120],
                [45, -100],
            ],
        })
    })
})
