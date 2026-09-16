import { test, expect, describe } from 'vitest'
import { parseCatalog } from '../../src/essence/Tools/LayerFilter/lib/catalog/parseCatalog.ts'
import { buildRows } from '../../src/essence/Tools/LayerFilter/lib/catalog/buildRows.ts'

// Mirrors the example catalogue in SCHEMA.md §5 (neutral values).
const catalogInput = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            id: 'entry-a',
            geometry: { type: 'Point', coordinates: [-97.7, 30.3] },
            properties: {
                title: 'Entry A',
                kind: ['K1'],
                start_datetime: '2025-01-05T00:00:00Z',
                end_datetime: '2025-03-31T00:00:00Z',
                layers: [
                    { key: 'stable-one', defaultOn: true },
                    { key: 'stable-two', defaultOn: false, opacity: 0.8, view: { zoom: 9 } },
                ],
            },
        },
        {
            type: 'Feature',
            id: 'entry-b',
            geometry: null,
            properties: {
                title: 'Entry B',
                kind: ['K2'],
                start_datetime: '2024-04-10T00:00:00Z',
                end_datetime: null,
                layers: [
                    { key: 'stable-one' },
                    { key: 'stable-ghost' }, // dangling on purpose
                ],
            },
        },
    ],
}

const layers = [
    { layerKey: 'uuid-1', layerProps: { key: 'stable-one', tag: ['Red'] } },
    { layerKey: 'uuid-2', layerProps: { key: 'stable-two', tag: ['Blue'] } },
    { layerKey: 'uuid-3', layerProps: { tag: ['Green'] } }, // no stable key
]

describe('parseCatalog', () => {
    const parsed = parseCatalog(catalogInput)

    test('extracts entries with datetimes split out of facet properties', () => {
        expect(parsed.entries.map((e) => e.id)).toEqual(['entry-a', 'entry-b'])
        const a = parsed.entries[0]
        expect(a.start).toBe('2025-01-05T00:00:00Z')
        expect(a.end).toBe('2025-03-31T00:00:00Z')
        expect(a.properties.kind).toEqual(['K1'])
        expect(a.properties.layers).toBeUndefined()
        expect(a.properties.start_datetime).toBeUndefined()
    })

    test('null end_datetime stays null (ongoing)', () => {
        expect(parsed.entries[1].end).toBeNull()
    })

    test('edges keep per-pairing attributes, key split out', () => {
        expect(parsed.edges['entry-a']).toEqual([
            { key: 'stable-one', attrs: { defaultOn: true } },
            { key: 'stable-two', attrs: { defaultOn: false, opacity: 0.8, view: { zoom: 9 } } },
        ])
    })

    describe('fails soft', () => {
        test('non-FeatureCollection input warns and yields empty', () => {
            const bad = parseCatalog({ hello: 'world' })
            expect(bad.entries).toEqual([])
            expect(bad.warnings.length).toBe(1)
        })
        test('null input yields empty without warning', () => {
            const empty = parseCatalog(null)
            expect(empty.entries).toEqual([])
            expect(empty.warnings).toEqual([])
        })
        test('feature without id is skipped with a warning', () => {
            const r = parseCatalog({
                type: 'FeatureCollection',
                features: [{ type: 'Feature', properties: {} }],
            })
            expect(r.entries).toEqual([])
            expect(r.warnings[0]).toContain('no id')
        })
        test('duplicate ids keep the first copy', () => {
            const r = parseCatalog({
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', id: 'x', properties: { n: 1 } },
                    { type: 'Feature', id: 'x', properties: { n: 2 } },
                ],
            })
            expect(r.entries.length).toBe(1)
            expect(r.entries[0].properties.n).toBe(1)
            expect(r.warnings[0]).toContain('duplicated')
        })
        test('pairing without key is skipped with a warning', () => {
            const r = parseCatalog({
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', id: 'x', properties: { layers: [{ defaultOn: true }] } },
                ],
            })
            expect(r.edges.x).toEqual([])
            expect(r.warnings[0]).toContain('no key')
        })
    })
})

describe('buildRows', () => {
    const built = buildRows(layers, parseCatalog(catalogInput))

    test('one row per resolved pairing, resolved to runtime layer keys', () => {
        const paired = built.rows.filter((r) => r.entry != null)
        expect(paired.map((r) => [r.layerKey, r.entry.id])).toEqual([
            ['uuid-1', 'entry-a'],
            ['uuid-2', 'entry-a'],
            ['uuid-1', 'entry-b'],
        ])
    })

    test('edge attributes ride the row', () => {
        const two = built.rows.find((r) => r.layerKey === 'uuid-2' && r.entry?.id === 'entry-a')
        expect(two.edge).toEqual({ defaultOn: false, opacity: 0.8, view: { zoom: 9 } })
    })

    test('dangling catalogue key warns and is skipped', () => {
        expect(built.warnings.some((w) => w.includes('stable-ghost'))).toBe(true)
        expect(built.rows.some((r) => r.layerKey === 'stable-ghost')).toBe(false)
    })

    test('layers with no pairings become unpaired rows', () => {
        const unpaired = built.rows.filter((r) => r.entry == null)
        expect(unpaired.map((r) => r.layerKey)).toEqual(['uuid-3'])
    })

    test('duplicate stable keys warn, first wins', () => {
        const dup = buildRows(
            [
                { layerKey: 'u1', layerProps: { key: 'same' } },
                { layerKey: 'u2', layerProps: { key: 'same' } },
            ],
            parseCatalog({
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', id: 'e', properties: { layers: [{ key: 'same' }] } },
                ],
            }),
        )
        expect(dup.warnings.some((w) => w.includes('more than one layer'))).toBe(true)
        const paired = dup.rows.filter((r) => r.entry != null)
        expect(paired.map((r) => r.layerKey)).toEqual(['u1'])
    })
})
