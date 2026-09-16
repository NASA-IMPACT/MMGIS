import { test, expect, describe } from 'vitest'
import { buildListedUpdates } from '../../src/essence/Tools/LayerFilter/lib/utils/listedUpdates.ts'
import {
    toEngineTheme,
    toEngineFacet,
} from '../../src/essence/Tools/LayerFilter/lib/utils/toEngineTheme.ts'

describe('LayerFilter buildListedUpdates', () => {
    const configs = {
        a: { type: 'tile', properties: {} },
        b: { type: 'vector', properties: {} },
        h: { type: 'header' },
    }
    test('complement map: matched true, others false, headers skipped', () => {
        expect(buildListedUpdates(configs, ['a'])).toEqual({ a: true, b: false })
    })
    test('empty matches unlist everything (headers still skipped)', () => {
        expect(buildListedUpdates(configs, [])).toEqual({ a: false, b: false })
    })
    test('null configs yield empty updates', () => {
        expect(buildListedUpdates(null, ['a'])).toEqual({})
    })
})

describe('LayerFilter toEngineTheme', () => {
    // [config filter, expected engine facet]
    const cases = [
        [
            { id: 'sector', property: 'sector', multi: true },
            { id: 'sector', source: 'layer', property: 'sector', matchAll: undefined },
        ],
        [
            { id: 'hazardType', property: 'hazards', from: 'catalog' },
            { id: 'hazardType', source: 'entry', property: 'hazards', matchAll: undefined },
        ],
        [
            { id: 'year', from: 'catalog', derived: 'datetimes' },
            { id: 'year', source: 'entryYears' },
        ],
        [
            { id: 'activation', from: 'catalog', isEntry: true },
            { id: 'activation', source: 'entryId' },
        ],
    ]
    for (const [input, expected] of cases) {
        test(`${input.id} maps to source ${expected.source}`, () => {
            expect(toEngineFacet(input)).toEqual(expected)
        })
    }

    test('a catalogue-bound theme requires entries; a plain one does not', () => {
        const evented = toEngineTheme({
            id: 'event',
            label: 'E',
            title: 'E',
            catalog: 'activations',
            filters: [{ id: 'x', from: 'catalog', isEntry: true }],
        })
        expect(evented.requireEntry).toBe(true)
        expect(evented.facets).toEqual([{ id: 'x', source: 'entryId' }])

        const plain = toEngineTheme({
            id: 'need',
            label: 'N',
            title: 'N',
            filters: [{ id: 'sector', property: 'sector' }],
        })
        expect(plain.requireEntry).toBe(false)
    })
})
