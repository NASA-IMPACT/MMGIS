import { describe, test, expect } from 'vitest'
import { formatLegendValue, formatLegendBound } from '../format.ts'

describe('formatLegendValue', () => {
    test('rounds a number, and falls back to exponential past the extremes', () => {
        expect(formatLegendValue(0)).toBe('0')
        expect(formatLegendValue(1.23456)).toBe('1.235')
        expect(formatLegendValue(123456)).toBe('1.23e+5')
        expect(formatLegendValue(0.0001)).toBe('1.00e-4')
    })

    // A bound the mission never set has to read as blank, never as 0.
    test('renders a missing or non-numeric value as itself, or as blank', () => {
        expect(formatLegendValue('n/a')).toBe('n/a')
        expect(formatLegendValue(null)).toBe('')
        expect(formatLegendValue(undefined)).toBe('')
        expect(formatLegendValue('   ')).toBe('')
    })
})

describe('formatLegendBound', () => {
    test('appends the unit to a numeric bound only', () => {
        expect(formatLegendBound(0, 'm')).toBe('0 m')
        expect(formatLegendBound('5', 'm')).toBe('5 m')
        expect(formatLegendBound(5, null)).toBe('5')
        // A bound that already spells out its unit must not repeat it.
        expect(formatLegendBound('<0.1 ppm', 'ppm')).toBe('<0.1 ppm')
    })
})
