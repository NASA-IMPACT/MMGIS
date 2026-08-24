import { test, expect, describe } from 'vitest'
import {
    bboxToPolygon,
    stacBboxToPolygon,
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

    describe('stacBboxToPolygon ([west, south, east, north] layer tag)', () => {
        test('converts a valid STAC bbox', () => {
            const poly = stacBboxToPolygon([-106.6, 25.8, -93.5, 36.5])
            expect(poly?.type).toBe('Polygon')
            expect(geometriesIntersect(austin, poly)).toBe(true)
        })

        test.each([
            ['not an array', 'texas'],
            ['wrong length', [-106.6, 25.8, -93.5]],
            ['non-numeric member', [-106.6, 25.8, -93.5, 'n']],
            ['non-finite member', [-106.6, 25.8, -93.5, Infinity]],
            ['null', null],
        ])('returns null for %s', (_name, value) => {
            expect(stacBboxToPolygon(value)).toBeNull()
        })
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
                toEngineFacet(
                    { id: 'location', from: 'catalog', type: 'geocode' },
                    { catalogTheme: true },
                ),
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

    describe('location semantics per theme kind', () => {
        // A CONUS-wide layer paired to a Texas-only activation.
        const conus = stacBboxToPolygon([-125, 24, -66, 50])
        const txEntry = {
            id: 'tx',
            properties: {},
            start: '2024-01-01T00:00:00Z',
            end: null,
            geometry: texas,
        }
        const pairedWide = {
            layerKey: 'l-wide',
            layerProps: {},
            layerGeometry: conus,
            entry: txEntry,
            edge: null,
        }
        const pairedNoBbox = {
            layerKey: 'l-untagged',
            layerProps: {},
            entry: txEntry,
            edge: null,
        }
        const unpairedTagged = {
            layerKey: 'l-stations',
            layerProps: {},
            layerGeometry: stacBboxToPolygon([-124.4, 32.5, -114.1, 42.0]),
            entry: null,
            edge: null,
        }
        const unpairedUntagged = {
            layerKey: 'l-nowhere',
            layerProps: {},
            entry: null,
            edge: null,
        }
        const rows = [pairedWide, pairedNoBbox, unpairedTagged, unpairedUntagged]
        const californiaPick = { label: 'California', geometry: california }

        test('catalog theme: only activation geometry counts — a wide layer cannot rescue a far-away activation', () => {
            const theme = {
                id: 'event',
                requireEntry: true,
                facets: [
                    toEngineFacet(
                        { id: 'location', from: 'catalog', type: 'geocode' },
                        { catalogTheme: true },
                    ),
                ],
            }
            const r = applyTheme(rows, theme, { location: californiaPick })
            expect(r.layerKeys).toEqual([])
        })

        test('layer theme: layer bbox first, activation geometry as fallback', () => {
            const theme = {
                id: 'hazard',
                facets: [
                    toEngineFacet({ id: 'location', type: 'geocode' }),
                ],
            }
            const r = applyTheme(rows, theme, { location: californiaPick })
            // Wide layer passes on its own bbox; untagged paired layer falls
            // back to its Texas activation and fails a California search;
            // unpaired layers pass only with a bbox tag of their own.
            expect(r.layerKeys.sort()).toEqual(['l-stations', 'l-wide'])

            const texasPick = { label: 'Texas', geometry: texas }
            const r2 = applyTheme(rows, theme, { location: texasPick })
            expect(r2.layerKeys.sort()).toEqual(['l-untagged', 'l-wide'])
        })
    })
})
