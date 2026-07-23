import { test, expect, describe } from 'vitest'
import {
    bboxToPolygon,
    geometriesIntersect,
} from '../../src/essence/Tools/LayerFilter/lib/utils/geo.ts'
import { toEngineFacet } from '../../src/essence/Tools/LayerFilter/lib/utils/toEngineTheme.ts'
import { applyTheme } from '../../src/essence/Tools/LayerFilter/lib/engine/index.ts'

const texas = {
    type: 'Polygon',
    coordinates: [[[-106.6, 25.8], [-93.5, 25.8], [-93.5, 36.5], [-106.6, 36.5], [-106.6, 25.8]]],
}
const california = {
    type: 'Polygon',
    coordinates: [[[-124.4, 32.5], [-114.1, 32.5], [-114.1, 42.0], [-124.4, 42.0], [-124.4, 32.5]]],
}
const austin = { type: 'Point', coordinates: [-97.7, 30.3] }

describe('LayerFilter geo', () => {
    describe('geometriesIntersect', () => {
        // [a, b, expected]
        const cases = [
            ['point in polygon', austin, texas, true],
            ['point outside polygon', austin, california, false],
            ['overlapping polygons', texas, bboxToPolygon([28, 33, -100, -95]), true],
            ['disjoint polygons', texas, california, false],
            ['missing geometry', null, texas, false],
            ['invalid geometry', { type: 'Nope' }, texas, false],
        ]
        for (const [label, a, b, expected] of cases) {
            test(`${label} -> ${expected}`, () => {
                expect(geometriesIntersect(a, b)).toBe(expected)
            })
        }
    })

    test('bboxToPolygon converts Nominatim [minLat, maxLat, minLon, maxLon]', () => {
        const poly = bboxToPolygon([25.8, 36.5, -106.6, -93.5])
        expect(poly.type).toBe('Polygon')
        expect(geometriesIntersect(austin, poly)).toBe(true)
    })

    describe('geocode facet end to end', () => {
        const rows = [
            { layerKey: 'l-tx', layerProps: {}, entry: { id: 'tx', properties: { kind: ['A'] }, start: '2024-01-01T00:00:00Z', end: null, geometry: austin }, edge: null },
            { layerKey: 'l-ca', layerProps: {}, entry: { id: 'ca', properties: { kind: ['B'] }, start: '2025-01-01T00:00:00Z', end: null, geometry: california }, edge: null },
        ]
        const theme = {
            id: 'cat',
            requireEntry: true,
            facets: [
                toEngineFacet({ id: 'location', from: 'catalog', type: 'geocode' }),
                { id: 'kind', source: 'entry', property: 'kind' },
                { id: 'pick', source: 'entryId' },
            ],
        }

        test('chosen place narrows entries by intersection (outward cascade)', () => {
            const r = applyTheme(rows, theme, {
                location: { label: 'Texas', geometry: texas },
            })
            expect(r.layerKeys).toEqual(['l-tx'])
            expect(r.options.pick.map((o) => o.value)).toEqual(['tx'])
            expect(r.options.kind.map((o) => o.value)).toEqual(['A'])
        })

        test('null selection passes everything', () => {
            const r = applyTheme(rows, theme, { location: null })
            expect(r.layerKeys.sort()).toEqual(['l-ca', 'l-tx'])
        })
    })
})
