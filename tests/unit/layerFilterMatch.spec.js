import { describe, test, expect } from 'vitest'
import {
    matchLayers,
    buildListedUpdates,
} from '../../src/essence/Tools/LayerFilter/lib/utils/matchLayers.ts'

const layers = {
    floodPrecip: { properties: { theme: 'hazard', hazard: 'flood', year: '2024' } },
    fireExtent: { properties: { theme: 'hazard', hazard: 'fire', year: '2025' } },
    caWildfire: { properties: { theme: 'event', hazard: 'fire', location: 'north_america', year: '2025' } },
    sectorAg: { properties: { theme: 'need', sector: 'agriculture' } },
    noProps: {}, // missing properties entirely
}

describe('LayerFilter matchLayers', () => {
    test('theme gate: only layers in the selected theme', () => {
        expect(matchLayers(layers, 'theme', 'hazard', {}).sort()).toEqual(
            ['fireExtent', 'floodPrecip'],
        )
    })

    test('a single active selection narrows within the theme', () => {
        expect(matchLayers(layers, 'theme', 'hazard', { hazard: 'flood' })).toEqual([
            'floodPrecip',
        ])
    })

    test('empty selection value means "all" (ignored)', () => {
        expect(matchLayers(layers, 'theme', 'hazard', { hazard: '' }).sort()).toEqual(
            ['fireExtent', 'floodPrecip'],
        )
    })

    test('multiple selections must all match (event theme)', () => {
        expect(
            matchLayers(layers, 'theme', 'event', {
                hazard: 'fire',
                location: 'north_america',
                year: '2025',
            }),
        ).toEqual(['caWildfire'])
        expect(
            matchLayers(layers, 'theme', 'event', { year: '2099' }),
        ).toEqual([])
    })

    test('layers missing the property do not match an active selection', () => {
        expect(matchLayers(layers, 'theme', 'need', { sector: 'water' })).toEqual([])
        expect(matchLayers(layers, 'theme', 'need', {})).toEqual(['sectorAg'])
    })

    test('layers with no properties never match a themed query', () => {
        expect(matchLayers(layers, 'theme', 'need', {})).not.toContain('noProps')
    })

    test('null/empty inputs are safe', () => {
        expect(matchLayers(null, 'theme', 'need', {})).toEqual([])
        expect(matchLayers({}, 'theme', 'need', {})).toEqual([])
    })

    test('array-valued theme: a layer belongs to multiple themes', () => {
        const multi = {
            shared: { properties: { theme: ['need', 'hazard', 'event'], hazard: 'fire' } },
        }
        expect(matchLayers(multi, 'theme', 'need', {})).toEqual(['shared'])
        expect(matchLayers(multi, 'theme', 'hazard', {})).toEqual(['shared'])
        expect(matchLayers(multi, 'theme', 'event', {})).toEqual(['shared'])
        expect(matchLayers(multi, 'theme', 'other', {})).toEqual([])
    })

    test('matching is case-insensitive: authored casing never forks a tag', () => {
        const cased = {
            upper: { properties: { theme: 'Hazard', hazard: 'Flood' } },
            arr: { properties: { theme: ['HAZARD'], hazard: ['flood'] } },
        }
        expect(matchLayers(cased, 'theme', 'hazard', { hazard: 'flood' }).sort()).toEqual(
            ['arr', 'upper'],
        )
        expect(matchLayers(cased, 'theme', 'Hazard', { hazard: 'FLOOD' }).sort()).toEqual(
            ['arr', 'upper'],
        )
    })

    test('array-valued selection property: matches if it contains the value', () => {
        const multi = {
            both: { properties: { theme: ['hazard'], hazard: ['fire', 'flood'] } },
        }
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'fire' })).toEqual(['both'])
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'flood' })).toEqual(['both'])
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'storm' })).toEqual([])
    })
})

describe('LayerFilter buildListedUpdates', () => {
    test('every real layer gets an entry: matched true, unmatched false', () => {
        expect(buildListedUpdates(layers, ['floodPrecip', 'sectorAg'])).toEqual({
            floodPrecip: true,
            fireExtent: false,
            caWildfire: false,
            sectorAg: true,
            noProps: false,
        })
    })

    test('headers are skipped (grouping nodes, not listable layers)', () => {
        const withHeader = {
            group: { type: 'header' },
            child: { properties: { theme: 'hazard' } },
        }
        expect(buildListedUpdates(withHeader, ['child'])).toEqual({
            child: true,
        })
    })

    test('no matches unlists everything; null configs are safe', () => {
        expect(buildListedUpdates(layers, [])).toEqual({
            floodPrecip: false,
            fireExtent: false,
            caWildfire: false,
            sectorAg: false,
            noProps: false,
        })
        expect(buildListedUpdates(null, ['x'])).toEqual({})
    })
})
