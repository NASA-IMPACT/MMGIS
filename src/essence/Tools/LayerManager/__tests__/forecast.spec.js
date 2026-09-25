import { test, expect } from 'vitest'
import { parseStep, formatRun, runAge, formatLead } from '../lib/utils/forecast.ts'

test.describe('forecast labels', () => {
    test('parseStep reads an ISO duration and refuses the rest', () => {
        expect(parseStep('PT1H')).toMatchObject({ hours: 1 })
        expect(parseStep('P1M')).toMatchObject({ months: 1 })
        expect(parseStep('1h')).toBeNull()
        expect(parseStep(7)).toBeNull()
    })
    test('formatRun names sub-daily runs by hour, daily by day, coarser by month', () => {
        expect(formatRun('2026-09-21T06:00:00', 'PT1H')).toBe('Sep 21, 06Z')
        expect(formatRun('2026-09-21T00:00:00', 'P1D')).toBe('Sep 21')
        expect(formatRun('2026-09-01T00:00:00', 'P1M')).toBe('Sep 2026')
        expect(formatRun('nope', 'PT1H')).toBe('nope')
    })
    test('runAge reads in hours under two days, else days', () => {
        const now = new Date('2026-09-21T12:00:00Z')
        expect(runAge('2026-09-21T06:00:00', now)).toBe('6 h ago')
        expect(runAge('2026-09-18T12:00:00', now)).toBe('3 d ago')
    })
    test('formatLead uses the step unit, or the duration itself when compound', () => {
        expect(formatLead(18, 'PT1H')).toBe('+18 h')
        expect(formatLead(3, 'P1D')).toBe('+3 d')
        expect(formatLead(2, 'P1M')).toBe('+2 mo')
        expect(formatLead(-1, 'PT1H')).toBe('-1 h')
        expect(formatLead(4, 'PT6H')).toBe('+4 × PT6H')
    })
})
