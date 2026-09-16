import { describe, test, expect } from 'vitest'
import { parseNamingProperty } from '../namingProperty'

describe('parseNamingProperty', () => {
    test('uses the property name as its own label when none is given', () => {
        expect(parseNamingProperty('density_rank')).toEqual({
            prop: 'density_rank',
            label: 'density_rank',
        })
    })

    test('reads a display label written after a pipe', () => {
        expect(parseNamingProperty('density_rank|Density Rank')).toEqual({
            prop: 'density_rank',
            label: 'Density Rank',
        })
    })

    test('trims the spacing an author leaves around either side', () => {
        expect(parseNamingProperty('  density_rank | Density Rank  ')).toEqual({
            prop: 'density_rank',
            label: 'Density Rank',
        })
    })

    test('falls back to the property name when the label is left empty', () => {
        expect(parseNamingProperty('density_rank|')).toEqual({
            prop: 'density_rank',
            label: 'density_rank',
        })
    })

    test('keeps a nested property path intact', () => {
        expect(parseNamingProperty('stores.food.candy|Candy')).toEqual({
            prop: 'stores.food.candy',
            label: 'Candy',
        })
    })

    test('only the first pipe separates, so a label may contain one', () => {
        expect(parseNamingProperty('rank|Rank | Percentile')).toEqual({
            prop: 'rank',
            label: 'Rank | Percentile',
        })
    })

    test('tolerates an entry that is not a usable string', () => {
        expect(parseNamingProperty('')).toEqual({ prop: '', label: '' })
        expect(parseNamingProperty(undefined as unknown as string)).toEqual({
            prop: '',
            label: '',
        })
    })
})
