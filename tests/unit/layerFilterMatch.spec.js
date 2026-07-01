import { test, expect } from '@playwright/test'
import { matchLayers } from '../../src/essence/Tools/LayerFilter/lib/utils/matchLayers.ts'

const layers = {
    floodPrecip: { properties: { theme: 'hazard', hazard: 'flood', year: '2024' } },
    fireExtent: { properties: { theme: 'hazard', hazard: 'fire', year: '2025' } },
    caWildfire: { properties: { theme: 'event', hazard: 'fire', location: 'north_america', year: '2025' } },
    sectorAg: { properties: { theme: 'need', sector: 'agriculture' } },
    noProps: {}, // missing properties entirely
}

test.describe('LayerFilter matchLayers', () => {
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

    test('array-valued selection property: matches if it contains the value', () => {
        const multi = {
            both: { properties: { theme: ['hazard'], hazard: ['fire', 'flood'] } },
        }
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'fire' })).toEqual(['both'])
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'flood' })).toEqual(['both'])
        expect(matchLayers(multi, 'theme', 'hazard', { hazard: 'storm' })).toEqual([])
    })
})
