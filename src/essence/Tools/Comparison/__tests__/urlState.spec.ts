import { describe, test, expect } from 'vitest'
import { decodeComparisonUrlState, encodeComparisonUrlState } from '../adapters/urlState'

const layers = {
    mode: 'layers' as const,
    layout: 'swipe' as const,
    leftLayerId: '0f1e2d3c-pm25',
    rightLayerId: '9a8b7c6d-o3',
    compareDate: null,
    swapped: false,
    dividerPos: 0.3,
}
const dates = {
    mode: 'dates' as const,
    layout: 'sideBySide' as const,
    leftLayerId: null,
    rightLayerId: null,
    compareDate: '2026-09-02T00:00:00.000Z',
    swapped: true,
    dividerPos: 0.5,
}

describe('comparison url state', () => {
    test('round-trips layers mode and dates mode', () => {
        expect(decodeComparisonUrlState(encodeComparisonUrlState(layers))).toEqual(layers)
        expect(decodeComparisonUrlState(encodeComparisonUrlState(dates))).toEqual(dates)
    })

    // The link's tools entry is split on commas before a tool sees its part,
    // and the fields are split on bars, so neither may appear inside a field.
    test('the encoding holds no commas, and strips them from any field', () => {
        const text = encodeComparisonUrlState({ ...layers, leftLayerId: 'a,b|c' })
        expect(text).not.toMatch(/,/)
        expect(decodeComparisonUrlState(text)?.leftLayerId).toBe('abc')
    })

    test('the divider is kept to two decimals inside 0..1', () => {
        expect(encodeComparisonUrlState({ ...layers, dividerPos: 0.123456 })).toMatch(/\|0\.12$/)
        expect(encodeComparisonUrlState({ ...layers, dividerPos: 7 })).toMatch(/\|1\.00$/)
    })

    test.each([
        ['', 'nothing'],
        ['layers|swipe|a|b|', 'too few fields'],
        ['both|swipe|a|b||0|0.5', 'an unknown mode'],
        ['layers|stacked|a|b||0|0.5', 'an unknown layout'],
        ['layers|swipe|a|b||0|1.5', 'a divider past 1'],
        ['dates|swipe|||not-a-date|0|0.5', 'an unreadable date'],
        [undefined, 'no entry'],
    ])('rejects %j (%s)', (text) => {
        expect(decodeComparisonUrlState(text as string)).toBeNull()
    })
})
