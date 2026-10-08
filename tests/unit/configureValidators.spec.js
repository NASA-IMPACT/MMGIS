import { describe, test, expect } from 'vitest'
import { validateLayer } from '../../configure/src/core/validators'

/**
 * A bounding box typed into Configure is the only extent a vector tile layer
 * ever has, and the one "Zoom to layer" trusts first on a vector layer. A
 * malformed one is flagged on the layer, where the author can fix it, rather
 * than sending the map nowhere at runtime.
 */

const boxErrors = (layer) =>
    validateLayer({ name: 'Layer', url: 'x', minZoom: 0, maxNativeZoom: 1, maxZoom: 1, ...layer })
        .filter((e) => e.field === 'boundingBox')
        .map((e) => e.message)

describe('bounding box on vector and vector tile layers', () => {
    test.each([
        ['vector', [-125, 24, -66, 50]],
        ['vectortile', ['-125', '24', '-66', '50']],
        ['MVTLayer', '-125,24,-66,50'],
        ['GeoJsonLayer', [-125, 24, -66, 50]],
    ])('accepts a well-formed box on a %s layer', (type, boundingBox) => {
        expect(boxErrors({ type, boundingBox })).toEqual([])
    })

    test.each([['vector'], ['MVTLayer']])('says nothing when a %s layer has no box', (type) => {
        expect(boxErrors({ type })).toEqual([])
        expect(boxErrors({ type, boundingBox: null })).toEqual([])
    })

    test.each([
        ['too few values', [-125, 24, -66]],
        ['a value that is not a number', [-125, 'south', -66, 50]],
        ['a short comma-separated string', '-125,24,-66'],
        ['a longitude past 180', [-190, 24, -66, 50]],
        ['a latitude past 90', [-125, 24, -66, 95]],
        ['south above north', [-125, 50, -66, 24]],
    ])('flags %s', (_label, boundingBox) => {
        expect(boxErrors({ type: 'MVTLayer', boundingBox })).toHaveLength(1)
    })

    test('does not add box checks to raster layers', () => {
        expect(boxErrors({ type: 'tile', boundingBox: [-190, 24, -66, 50] })).toEqual([])
    })
})
