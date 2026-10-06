import { describe, test, expect, beforeEach, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_` — so a
// bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * A `local` vector layer is fetched once and filtered on the client against
 * the window TimeControl stamped on it, both edges inclusive. For a periodic
 * layer that window is one period, its end the period's last whole second,
 * so a feature stamped on the next period's first instant belongs to the
 * next period and one stamped on this period's last second to this one.
 */

const feature = (id, when) => ({
    type: 'Feature',
    properties: { id, when },
    geometry: { type: 'Point', coordinates: [0, 0] },
})

const source = () => ({
    type: 'FeatureCollection',
    features: [
        feature('before', '2022-06-14T23:59:59Z'),
        feature('first-second', '2022-06-15T00:00:00Z'),
        feature('midday', '2022-06-15T12:00:00Z'),
        feature('last-second', '2022-06-15T23:59:59Z'),
        feature('next-first-second', '2022-06-16T00:00:00Z'),
    ],
})

let updated

beforeEach(() => {
    updated = []
    L_.layers.data = {
        sightings: {
            name: 'sightings',
            type: 'vector',
            time: { enabled: true, type: 'local', endProp: 'when' },
        },
    }
    L_.layers.nameToUUID = {}
    L_.layers.layer = { sightings: { _sourceGeoJSON: source() } }
    L_._localTimeFilterCache = {}
    L_.clearVectorLayer = vi.fn()
    L_.updateVectorLayer = vi.fn((name, geojson) => {
        updated.push(geojson.features.map((f) => f.properties.id))
    })
})

describe('L_.timeFilterVectorLayer over a period', () => {
    test('keeps the features stamped inside the period, both edges inclusive', () => {
        L_.timeFilterVectorLayer(
            'sightings',
            Date.parse('2022-06-15T00:00:00Z'),
            Date.parse('2022-06-15T23:59:59Z')
        )

        expect(updated).toEqual([['first-second', 'midday', 'last-second']])
    })

    test('a feature on the next period\'s first instant belongs to the next period', () => {
        L_.timeFilterVectorLayer(
            'sightings',
            Date.parse('2022-06-16T00:00:00Z'),
            Date.parse('2022-06-16T23:59:59Z')
        )

        expect(updated).toEqual([['next-first-second']])
    })

    test('a later period filters the same source, not the earlier result', () => {
        L_.timeFilterVectorLayer(
            'sightings',
            Date.parse('2022-06-15T00:00:00Z'),
            Date.parse('2022-06-15T23:59:59Z')
        )
        L_.timeFilterVectorLayer(
            'sightings',
            Date.parse('2022-06-16T00:00:00Z'),
            Date.parse('2022-06-16T23:59:59Z')
        )

        expect(updated[1]).toEqual(['next-first-second'])
    })
})
