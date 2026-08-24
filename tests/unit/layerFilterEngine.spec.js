import { test, expect, describe } from 'vitest'
import {
    applyTheme,
    yearSpan,
    isOngoing,
} from '../../src/essence/Tools/LayerFilter/lib/engine/index.ts'

// Neutral fixtures on purpose — the engine (and its tests) must contain no
// app-domain vocabulary; themes/facets are pure configuration.

const NOW = Date.parse('2025-07-01T00:00:00Z')

const entries = {
    e1: { id: 'e1', properties: { kind: ['A'] },      start: '2024-04-10T00:00:00Z', end: '2024-05-01T00:00:00Z', geometry: { zone: 'west' } },
    e2: { id: 'e2', properties: { kind: ['B'] },      start: '2025-01-05T00:00:00Z', end: '2025-03-31T00:00:00Z', geometry: { zone: 'east' } },
    e3: { id: 'e3', properties: { kind: ['C'] },      start: '2024-12-01T00:00:00Z', end: '2025-02-01T00:00:00Z', geometry: { zone: 'west' } },
    e4: { id: 'e4', properties: { kind: ['A', 'B'] }, start: '2025-06-01T00:00:00Z', end: null,                   geometry: { zone: 'east' } },
}

const row = (layerKey, layerProps, entry, edge = null) => ({ layerKey, layerProps, entry, edge })

const rows = [
    row('alpha', { tag: ['Red', 'Blue'] }, entries.e1),
    row('alpha', { tag: ['Red', 'Blue'] }, entries.e2),
    row('beta',  { tag: ['Red'] },         entries.e1),
    row('beta',  { tag: ['Red'] },         entries.e4),
    row('gamma', { tag: ['blue'] },        entries.e3),
    row('delta', { tag: [] },              null), // unpaired layer
]

const catalogTheme = {
    id: 'cat',
    requireEntry: true,
    facets: [
        { id: 'kind', source: 'entry', property: 'kind' },
        { id: 'year', source: 'entryYears' },
        { id: 'pick', source: 'entryId' },
    ],
}

const layerTheme = {
    id: 'flat',
    facets: [{ id: 'tag', source: 'layer', property: 'tag', multi: true }],
}

const opts = { now: NOW }
const values = (result, facetId) => result.options[facetId].map((o) => o.value)

describe('LayerFilter engine', () => {
    describe('derive', () => {
        test('yearSpan crosses year boundaries', () => {
            expect(yearSpan('2024-12-01T00:00:00Z', '2025-02-01T00:00:00Z')).toEqual(['2024', '2025'])
        })
        test('yearSpan of ongoing entry runs through now', () => {
            expect(yearSpan('2024-06-01T00:00:00Z', null, NOW)).toEqual(['2024', '2025'])
        })
        test('yearSpan on garbage yields []', () => {
            expect(yearSpan('not a date', null, NOW)).toEqual([])
            expect(yearSpan(null, null, NOW)).toEqual([])
        })
        test('isOngoing: null end, future end, past end', () => {
            expect(isOngoing(null, NOW)).toBe(true)
            expect(isOngoing('2025-12-01T00:00:00Z', NOW)).toBe(true)
            expect(isOngoing('2024-01-01T00:00:00Z', NOW)).toBe(false)
        })
    })

    describe('no selection = no narrowing', () => {
        const r = applyTheme(rows, catalogTheme, {}, opts)
        test('all entries offered', () => {
            expect(values(r, 'pick').sort()).toEqual(['e1', 'e2', 'e3', 'e4'])
        })
        test('years derived across all entries', () => {
            expect(values(r, 'year').sort()).toEqual(['2024', '2025'])
        })
        test('unpaired layers excluded by requireEntry', () => {
            expect(r.layerKeys.sort()).toEqual(['alpha', 'beta', 'gamma'])
        })
    })

    describe('the cascade rule', () => {
        test('year narrows pick and kind — but never itself', () => {
            const r = applyTheme(rows, catalogTheme, { year: '2024' }, opts)
            expect(values(r, 'pick').sort()).toEqual(['e1', 'e3']) // e3 via boundary span
            expect(values(r, 'kind').sort()).toEqual(['A', 'C'])
            expect(values(r, 'year').sort()).toEqual(['2024', '2025']) // own-facet exemption
        })
        test('picking an entry narrows year and kind symmetrically', () => {
            const r = applyTheme(rows, catalogTheme, { pick: 'e2' }, opts)
            expect(values(r, 'year')).toEqual(['2025'])
            expect(values(r, 'kind')).toEqual(['B'])
            expect(r.layerKeys).toEqual(['alpha'])
        })
        test('boundary-spanning entry matches either year', () => {
            const y24 = applyTheme(rows, catalogTheme, { year: '2024' }, opts)
            const y25 = applyTheme(rows, catalogTheme, { year: '2025' }, opts)
            expect(values(y24, 'pick')).toContain('e3')
            expect(values(y25, 'pick')).toContain('e3')
        })
    })

    describe('invalidation', () => {
        test('stale entry auto-clears when the user changes a facet past it', () => {
            // pick=e2 was selected earlier; the user just changed year to 2024.
            const r = applyTheme(
                rows,
                catalogTheme,
                { pick: 'e2', year: '2024' },
                { ...opts, changedFacetId: 'year' },
            )
            expect(r.selections.pick).toBeNull()
            expect(r.selections.year).toBe('2024')
            expect(r.layerKeys.sort()).toEqual(['alpha', 'beta', 'gamma'])
        })
        test('the just-changed facet is never the one cleared', () => {
            // Same contradiction, opposite gesture: the user just picked e2.
            const r = applyTheme(
                rows,
                catalogTheme,
                { pick: 'e2', year: '2024' },
                { ...opts, changedFacetId: 'pick' },
            )
            expect(r.selections.pick).toBe('e2')
            expect(r.selections.year).toBeNull()
        })
        test('without the hint, the earliest invalid facet in definition order clears', () => {
            const r = applyTheme(rows, catalogTheme, { pick: 'e2', year: '2024' }, opts)
            expect(r.selections.year).toBeNull()
            expect(r.selections.pick).toBe('e2')
        })
        test('valid selection survives untouched', () => {
            const r = applyTheme(rows, catalogTheme, { pick: 'e1', year: '2024' }, opts)
            expect(r.selections.pick).toBe('e1')
            expect(r.layerKeys.sort()).toEqual(['alpha', 'beta'])
        })
    })

    describe('multi-select semantics', () => {
        test('any-overlap by default (case-insensitive)', () => {
            const r = applyTheme(rows, layerTheme, { tag: ['blue'] }, opts)
            expect(r.layerKeys.sort()).toEqual(['alpha', 'gamma'])
        })
        test('matchAll requires every selected value', () => {
            const theme = {
                id: 'flat',
                facets: [{ id: 'tag', source: 'layer', property: 'tag', matchAll: true }],
            }
            const r = applyTheme(rows, theme, { tag: ['red', 'blue'] }, opts)
            expect(r.layerKeys).toEqual(['alpha'])
        })
        test('case variants merge into one option, first-seen casing wins', () => {
            const r = applyTheme(rows, layerTheme, {}, opts)
            const blue = r.options.tag.find((o) => o.value === 'Blue')
            expect(blue).toBeDefined()
            expect(blue.count).toBe(2) // alpha + gamma, distinct layers
            expect(values(r, 'tag')).not.toContain('blue')
        })
    })

    describe('counts', () => {
        test('entry-sourced facets count entries; layer-sourced count layers', () => {
            const r = applyTheme(rows, catalogTheme, {}, opts)
            const kindA = r.options.kind.find((o) => o.value === 'A')
            expect(kindA.count).toBe(2) // e1, e4
            const flat = applyTheme(rows, layerTheme, {}, opts)
            const red = flat.options.tag.find((o) => o.value === 'Red')
            expect(red.count).toBe(2) // alpha, beta (deduped across alpha's two rows)
        })
    })

    describe('predicate facets', () => {
        const zoneFacet = {
            id: 'zone',
            kind: 'predicate',
            test: (r, selection) => r.entry?.geometry?.zone === selection,
        }
        const theme = { ...catalogTheme, facets: [...catalogTheme.facets, zoneFacet] }

        test('inactive (null) predicate passes everything', () => {
            const r = applyTheme(rows, theme, {}, opts)
            expect(values(r, 'pick').sort()).toEqual(['e1', 'e2', 'e3', 'e4'])
        })
        test('active predicate narrows rows AND other facets (outward cascade)', () => {
            const r = applyTheme(rows, theme, { zone: 'west' }, opts)
            expect(values(r, 'pick').sort()).toEqual(['e1', 'e3'])
            expect(values(r, 'kind').sort()).toEqual(['A', 'C'])
            expect(r.layerKeys.sort()).toEqual(['alpha', 'beta', 'gamma'])
        })
    })

    describe('unpaired layers in layer-scoped themes', () => {
        test('present with no selection, excluded once a tag is required', () => {
            const all = applyTheme(rows, layerTheme, {}, opts)
            expect(all.layerKeys).toContain('delta')
            const tagged = applyTheme(rows, layerTheme, { tag: 'red' }, opts)
            expect(tagged.layerKeys).not.toContain('delta')
        })
    })
})
