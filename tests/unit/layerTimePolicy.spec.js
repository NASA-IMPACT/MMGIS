import { describe, test, expect } from 'vitest'
import { resolveTimePolicy } from '../../src/essence/Basics/TimeControl_/layerTimePolicy'

// Injected "now" so results are exact: mid-afternoon UTC.
const NOW = new Date('2026-08-25T15:42:31.500Z')

describe('resolveTimePolicy', () => {
    test('a concrete ISO datetime passes through, normalized', () => {
        expect(
            resolveTimePolicy('2025-01-12T23:59:59+00:00', { now: NOW }),
        ).toBe('2025-01-12T23:59:59Z')
    })

    test('an absent or unreadable value resolves to null', () => {
        expect(resolveTimePolicy(null, { now: NOW })).toBeNull()
        expect(resolveTimePolicy('not-a-date', { now: NOW })).toBeNull()
        expect(resolveTimePolicy('now - garbage', { now: NOW })).toBeNull()
    })

    // Calendar-unit offsets step by calendar, not by a fixed number of
    // milliseconds: one month back from late August is late July.
    test('"now" is the raw current moment, and offsets step from it', () => {
        expect(resolveTimePolicy('now', { now: NOW })).toBe(
            '2026-08-25T15:42:31Z',
        )
        expect(resolveTimePolicy('now - P1D', { now: NOW })).toBe(
            '2026-08-24T15:42:31Z',
        )
        expect(resolveTimePolicy('now+P5D', { now: NOW })).toBe(
            '2026-08-30T15:42:31Z',
        )
        expect(resolveTimePolicy('now - PT6H', { now: NOW })).toBe(
            '2026-08-25T09:42:31Z',
        )
        expect(resolveTimePolicy('now  -  P1M', { now: NOW })).toBe(
            '2026-07-25T15:42:31Z',
        )
    })
})
