import { describe, test, expect } from 'vitest'
import {
    distinctValues,
    yearsFromTimeConfig,
    resolveOptions,
} from '../../src/essence/Tools/LayerFilter/lib/utils/resolveOptions.ts'

const layers = {
    a: { properties: { sector: 'water', hazard: ['flood', 'storm'] } },
    b: { properties: { sector: 'water', hazard: 'fire' } },
    c: { properties: { sector: 'energy' } },
    d: { properties: {} },
    e: {},
}

describe('LayerFilter resolveOptions', () => {
    test('distinctValues: sorted, deduped, scalar + array, skips empty', () => {
        expect(distinctValues(layers, 'sector')).toEqual(['energy', 'water'])
        expect(distinctValues(layers, 'hazard')).toEqual(['fire', 'flood', 'storm'])
        expect(distinctValues(layers, 'missing')).toEqual([])
        expect(distinctValues(null, 'sector')).toEqual([])
    })

    test('distinctValues: case variants merge, first-seen casing displayed', () => {
        const cased = {
            a: { properties: { sector: 'Water' } },
            b: { properties: { sector: 'water' } },
            c: { properties: { sector: ['WATER', 'Energy'] } },
        }
        expect(distinctValues(cased, 'sector')).toEqual(['Energy', 'Water'])
    })

    test('yearsFromTimeConfig: newest-first across the range', () => {
        expect(
            yearsFromTimeConfig({
                start: '2023-03-13T00:00:00Z',
                end: '2026-01-29T00:00:00Z',
            }),
        ).toEqual(['2026', '2025', '2024', '2023'])
        expect(yearsFromTimeConfig({})).toEqual([])
        expect(yearsFromTimeConfig(null)).toEqual([])
        expect(yearsFromTimeConfig({ start: 'x', end: 'y' })).toEqual([])
    })

    test('yearsFromTimeConfig: absurd spans are capped, not rendered', () => {
        const years = yearsFromTimeConfig({
            start: '0001-01-01T00:00:00Z',
            end: '2026-01-01T00:00:00Z',
        })
        expect(years.length).toBe(151)
        expect(years[0]).toBe('2026')
    })

    test('resolveOptions: explicit config options win', () => {
        const filter = {
            id: 'sector',
            label: 'Sector',
            property: 'sector',
            type: 'select',
            options: [{ value: 'water', label: 'Water Resources' }],
        }
        expect(resolveOptions(filter, layers, null)).toEqual([
            { value: 'water', label: 'Water Resources' },
        ])
    })

    test('resolveOptions: derives from data when options omitted (title-cased)', () => {
        const filter = { id: 'sector', label: 'Sector', property: 'sector', type: 'select' }
        expect(resolveOptions(filter, layers, null)).toEqual([
            { value: 'energy', label: 'Energy' },
            { value: 'water', label: 'Water' },
        ])
    })

    test('resolveOptions: optionsFrom "time" uses the resolved time range', () => {
        const filter = {
            id: 'year',
            label: 'Year',
            property: 'year',
            type: 'select',
            optionsFrom: 'time',
        }
        const time = { start: '2024-01-01T00:00:00Z', end: '2025-06-01T00:00:00Z' }
        expect(resolveOptions(filter, layers, time)).toEqual([
            { value: '2025', label: '2025' },
            { value: '2024', label: '2024' },
        ])
    })

    test('resolveOptions: empty/unusable time range falls back to the data', () => {
        const filter = {
            id: 'year',
            label: 'Year',
            property: 'year',
            type: 'select',
            optionsFrom: 'time',
        }
        const yearLayers = { a: { properties: { year: '2024' } } }
        expect(resolveOptions(filter, yearLayers, null)).toEqual([
            { value: '2024', label: '2024' },
        ])
        expect(resolveOptions(filter, yearLayers, { start: 'now', end: '' })).toEqual([
            { value: '2024', label: '2024' },
        ])
    })
})
