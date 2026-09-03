import { describe, test, expect } from 'vitest'
import {
    resolveTimePolicy,
    resolveTemporalExtent,
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

        test.each([['garbage'], ['P'], ['1D'], ['']])('rejects %s', (value) => {
            expect(parseISODuration(value)).toBeNull()
        })
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

    describe('resolveTemporalExtent', () => {
        test('without an interval both policies resolve, nothing snaps', () => {
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-08-15T00:00:00Z',
                        dataEndTime: 'now',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-08-15T00:00:00Z',
                end: '2026-08-25T15:42:31Z',
            })
        })

        test('a 7-day cadence begun ten days ago ends three days ago, not now', () => {
            // NOW is Aug 25; steps land Aug 15, Aug 22, (Aug 29 is future).
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-08-15T00:00:00Z',
                        dataEndTime: 'now',
                        interval: 'P7D',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-08-15T00:00:00Z',
                end: '2026-08-22T00:00:00Z',
            })
        })

        test('an end exactly on a step stays put', () => {
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-08-01T00:00:00Z',
                        dataEndTime: '2026-08-15T00:00:00Z',
                        interval: 'P7D',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-08-01T00:00:00Z',
                end: '2026-08-15T00:00:00Z',
            })
        })

        test('a concrete off-step end also floors — no data exists there', () => {
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-08-01T00:00:00Z',
                        dataEndTime: '2026-08-20T00:00:00Z',
                        interval: 'P7D',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-08-01T00:00:00Z',
                end: '2026-08-15T00:00:00Z',
            })
        })

        test('monthly cadence steps by calendar months, not fixed ms', () => {
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-01-15T00:00:00Z',
                        dataEndTime: 'now',
                        interval: 'P1M',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-01-15T00:00:00Z',
                end: '2026-08-15T00:00:00Z',
            })
        })

        test('monthly cadence stays anchored to the start day-of-month', () => {
            // Jan 31 + N months in one calendar operation: Jul 31 fits,
            // Aug 31 is past NOW. Iterated stepping would have drifted
            // to Mar 3 at the first short month.
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-01-31T00:00:00Z',
                        dataEndTime: 'now',
                        interval: 'P1M',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-01-31T00:00:00Z',
                end: '2026-07-31T00:00:00Z',
            })
        })

        test('policy start anchors the grid too', () => {
            // start = now - P1M = Jul 25 15:42:31; weekly steps reach
            // Aug 22 15:42:31 before overshooting NOW.
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: 'now - P1M',
                        dataEndTime: 'now',
                        interval: 'P7D',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-07-25T15:42:31Z',
                end: '2026-08-22T15:42:31Z',
            })
        })

        test('an end before the start clamps to the start', () => {
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-08-20T00:00:00Z',
                        dataEndTime: '2026-08-10T00:00:00Z',
                        interval: 'P1D',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2026-08-20T00:00:00Z',
                end: '2026-08-20T00:00:00Z',
            })
        })

        test.each([['every tuesday'], ['P0D'], ['PT0S']])(
            'interval %s is ignored, never breaking the extent',
            (interval) => {
                expect(
                    resolveTemporalExtent(
                        {
                            dataStartTime: '2026-08-15T00:00:00Z',
                            dataEndTime: 'now',
                            interval,
                        },
                        { now: NOW },
                    ),
                ).toEqual({
                    start: '2026-08-15T00:00:00Z',
                    end: '2026-08-25T15:42:31Z',
                })
            },
        )

        test('an interval without a start has no anchor — end unsnapped', () => {
            expect(
                resolveTemporalExtent(
                    { dataEndTime: 'now', interval: 'P7D' },
                    { now: NOW },
                ),
            ).toEqual({ start: null, end: '2026-08-25T15:42:31Z' })
        })

        test('an absent time block resolves to a null extent', () => {
            expect(resolveTemporalExtent(undefined, { now: NOW })).toEqual({
                start: null,
                end: null,
            })
            expect(resolveTemporalExtent(null, { now: NOW })).toEqual({
                start: null,
                end: null,
            })
        })
    })
})
