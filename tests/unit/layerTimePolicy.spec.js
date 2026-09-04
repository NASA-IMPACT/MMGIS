import { describe, test, expect } from 'vitest'
import {
    resolveTimePolicy,
    parseISODuration,
} from '../../src/essence/Basics/TimeControl_/layerTimePolicy'

// Injected "now" so results are exact: mid-afternoon UTC.
const NOW = new Date('2026-08-25T15:42:31.500Z')

describe('layer time policy', () => {
    describe('parseISODuration', () => {
        test.each([
            ['P1D', { days: 1 }],
            ['PT1H', { hours: 1 }],
            ['P1M', { months: 1 }],
            ['P2W', { weeks: 2 }],
            ['P1DT12H', { days: 1, hours: 12 }],
        ])('parses %s', (value, expected) => {
            expect(parseISODuration(value)).toMatchObject(expected)
        })

        test('parses a full compound duration', () => {
            expect(parseISODuration('P1Y2M3DT4H5M6S')).toEqual({
                years: 1,
                months: 2,
                weeks: 0,
                days: 3,
                hours: 4,
                minutes: 5,
                seconds: 6,
            })
        })

        // 'P0D' is well-formed and length zero: nothing to offset by, and no
        // period it could ever contain.
        test.each([['garbage'], ['P'], ['1D'], [''], ['P0D'], ['P0DT0H']])(
            'rejects %s',
            (value) => {
                expect(parseISODuration(value)).toBeNull()
            },
        )
    })

    describe('resolveTimePolicy', () => {
        test('concrete ISO datetimes pass through, normalized', () => {
            expect(
                resolveTimePolicy('2025-01-12T23:59:59+00:00', { now: NOW }),
            ).toBe('2025-01-12T23:59:59Z')
        })

        test('absent or unparseable values resolve to null', () => {
            expect(resolveTimePolicy(null, { now: NOW })).toBeNull()
            expect(resolveTimePolicy(undefined, { now: NOW })).toBeNull()
            expect(resolveTimePolicy('', { now: NOW })).toBeNull()
            expect(resolveTimePolicy('not-a-date', { now: NOW })).toBeNull()
            expect(resolveTimePolicy('now - garbage', { now: NOW })).toBeNull()
        })

        test('"now" is the raw current moment — no rounding (veda-ui rule)', () => {
            expect(resolveTimePolicy('now', { now: NOW })).toBe(
                '2026-08-25T15:42:31Z',
            )
        })

        test('offsets: "now - P1D" and forecast-style "now + P5D"', () => {
            expect(resolveTimePolicy('now - P1D', { now: NOW })).toBe(
                '2026-08-24T15:42:31Z',
            )
            expect(resolveTimePolicy('now + P5D', { now: NOW })).toBe(
                '2026-08-30T15:42:31Z',
            )
        })

        test('sub-day and calendar-unit offsets use date math, not ms math', () => {
            expect(resolveTimePolicy('now - PT6H', { now: NOW })).toBe(
                '2026-08-25T09:42:31Z',
            )
            // One month back from late August is late July — a fixed-ms
            // implementation would drift.
            expect(resolveTimePolicy('now - P1M', { now: NOW })).toBe(
                '2026-07-25T15:42:31Z',
            )
        })

        test('spacing around the sign is flexible', () => {
            expect(resolveTimePolicy('now-P1D', { now: NOW })).toBe(
                '2026-08-24T15:42:31Z',
            )
            expect(resolveTimePolicy('now  +  P1D', { now: NOW })).toBe(
                '2026-08-26T15:42:31Z',
            )
        })
    })
})
