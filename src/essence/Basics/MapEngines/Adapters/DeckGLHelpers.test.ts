import { describe, it, expect } from 'vitest'
import { resolveExtent } from './DeckGLHelpers'

describe('resolveExtent', () => {
    it('converts Leaflet-order corner tuples to [minX, minY, maxX, maxY]', () => {
        // Tuples are [lat, lng]; deck.gl wants lng/lat, min then max.
        expect(
            resolveExtent([
                [9.013243, -70.050557],
                [11.531936, -67.481667],
            ])
        ).toEqual([-70.050557, 9.013243, -67.481667, 11.531936])
    })

    it('accepts the {southWest, northEast} object shape', () => {
        expect(
            resolveExtent({
                southWest: { lat: 33.7, lng: -118.95 },
                northEast: { lat: 34.55, lng: -117.65 },
            })
        ).toEqual([-118.95, 33.7, -117.65, 34.55])
    })

    // Callers hand bounds over in whichever order they happen to hold them;
    // deck.gl only accepts min-then-max, so a swapped pair must not survive.
    it('normalises corners given in the wrong order', () => {
        expect(
            resolveExtent([
                [34.55, -117.65],
                [33.7, -118.95],
            ])
        ).toEqual([-118.95, 33.7, -117.65, 34.55])
    })

    // The tile path builds bounds with L.latLngBounds, whose corners are only
    // reachable through methods. Reading the plain properties off one yields
    // undefined, so this shape has to be unwrapped or every bounded layer
    // silently goes back to requesting the whole pyramid.
    it('accepts a Leaflet LatLngBounds, whose corners are accessors', () => {
        const leafletish = {
            getSouthWest: () => ({ lat: 9.013243, lng: -70.050557 }),
            getNorthEast: () => ({ lat: 11.531936, lng: -67.481667 }),
        }
        expect(resolveExtent(leafletish as never)).toEqual([
            -70.050557, 9.013243, -67.481667, 11.531936,
        ])
    })

    it('handles an extent spanning the equator and prime meridian', () => {
        expect(
            resolveExtent([
                [-10, -20],
                [10, 20],
            ])
        ).toEqual([-20, -10, 20, 10])
    })

    // A null extent leaves the layer unbounded, which is the behaviour that
    // held before an extent was passed at all — strictly better than passing
    // deck.gl a partial one built from junk.
    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('returns null for %s bounds', (_label, bounds) => {
        expect(resolveExtent(bounds as never)).toBeNull()
    })

    it.each([
        ['NaN in a corner', [[Number.NaN, 0], [1, 1]]],
        ['Infinity in a corner', [[0, 0], [Number.POSITIVE_INFINITY, 1]]],
        ['non-numeric corner', [['a', 'b'], [1, 1]]],
    ])('returns null when bounds hold %s', (_label, bounds) => {
        expect(resolveExtent(bounds as never)).toBeNull()
    })

    it('returns null rather than throwing on a malformed shape', () => {
        expect(resolveExtent({} as never)).toBeNull()
        expect(resolveExtent([] as never)).toBeNull()
    })

    it('keeps a zero-area extent, which is a valid degenerate footprint', () => {
        expect(
            resolveExtent([
                [5, 5],
                [5, 5],
            ])
        ).toEqual([5, 5, 5, 5])
    })
})
