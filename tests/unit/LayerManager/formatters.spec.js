import { test, expect } from '@playwright/test'
import { formatValue, formatRange, formatPercent, interpolateValue } from '../../../src/essence/Tools/LayerManager/lib/utils/formatters.ts'

test.describe('formatters', () => {
    test('formatValue handles integers, decimals, NaN', () => {
        expect(formatValue(42)).toBe('42')
        expect(formatValue(3.14159)).toBe('3.14')
        expect(formatValue('3.50')).toBe('3.5')
        expect(formatValue(null)).toBe('')
        expect(formatValue('abc')).toBe('abc')
    })
    test('formatRange composes min/max with unit', () => {
        expect(formatRange(0, 10, 'm')).toBe('0 - 10 m')
        expect(formatRange(0.5, 1.5)).toBe('0.5 - 1.5')
    })
    test('formatPercent rounds', () => {
        expect(formatPercent(0.123)).toBe('12%')
        expect(formatPercent(0.5)).toBe('50%')
    })
    test('interpolateValue lerps between min/max', () => {
        expect(interpolateValue(0, 10, 0.5)).toBe(5)
        expect(interpolateValue(0, 100, 0)).toBe(0)
        expect(interpolateValue(0, 100, 1)).toBe(100)
        expect(interpolateValue('a', 'b', 0.5)).toBeNull()
    })
})
