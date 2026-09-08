import { describe, test, expect } from 'vitest'
import { formatLegendValue, formatLegendBound } from '../format.ts'

describe('formatLegendValue', () => {
    test('zero renders as a bare 0', () => {
        expect(formatLegendValue(0)).toBe('0')
    })

    test('rounds to three significant decimals', () => {
        expect(formatLegendValue(1.23456)).toBe('1.235')
    })

    test('falls back to exponential above the magnitude ceiling', () => {
        expect(formatLegendValue(123456)).toBe('1.23e+5')
    })

    test('falls back to exponential below the magnitude floor', () => {
        expect(formatLegendValue(0.0001)).toBe('1.00e-4')
    })

    test('passes non-numeric input through untouched', () => {
        expect(formatLegendValue('n/a')).toBe('n/a')
    })

    test('renders null/undefined/blank as blank, not 0', () => {
        expect(formatLegendValue(null)).toBe('')
        expect(formatLegendValue(undefined)).toBe('')
        expect(formatLegendValue('')).toBe('')
        expect(formatLegendValue('   ')).toBe('')
    })
})

describe('formatLegendBound', () => {
    test('appends the unit when one is supplied', () => {
        expect(formatLegendBound(5, 'm')).toBe('5 m')
    })

    test('is bare when no unit is supplied', () => {
        expect(formatLegendBound(5, null)).toBe('5')
    })

    test('missing bounds render blank, with no dangling unit', () => {
        expect(formatLegendBound(null, 'm')).toBe('')
        expect(formatLegendBound(undefined, 'm')).toBe('')
        expect(formatLegendBound('', 'ppm')).toBe('')
    })

    test('a non-numeric bound renders verbatim, once, with no unit appended', () => {
        expect(formatLegendBound('<0.1 ppm', 'ppm')).toBe('<0.1 ppm')
    })

    test('a numeric bound (number or numeric string) still gets its unit', () => {
        expect(formatLegendBound(0, 'm')).toBe('0 m')
        expect(formatLegendBound('5', 'm')).toBe('5 m')
    })
})
