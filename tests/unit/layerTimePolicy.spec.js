import { describe, test, expect } from 'vitest'
import {
    resolveTimePolicy,
    resolveTemporalExtent,
    parseISODuration,
    layerRequestWindow,
    isPeriodicRequest,
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

        test('an offset past the representable date range resolves to null', () => {
            // Durations are unbounded; these push the Date past its
            // +/-273,790-year limit, where toISOString() would throw.
            expect(
                resolveTimePolicy('now - P999999999Y', { now: NOW }),
            ).toBeNull()
            expect(
                resolveTimePolicy('now + P20000000000D', { now: NOW }),
            ).toBeNull()
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

        test('an out-of-range policy nulls only its own end, never throws', () => {
            // The bulk `layers:getTemporalExtent` handler resolves every
            // layer in one pass — one unbounded config must not reject it.
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2026-01-01T00:00:00Z',
                        dataEndTime: 'now + P999999999Y',
                    },
                    { now: NOW },
                ),
            ).toEqual({ start: '2026-01-01T00:00:00Z', end: null })
        })

        test('a cadence longer than the span floors to the start itself', () => {
            // The last 1000-year step at or before now is step 0.
            expect(
                resolveTemporalExtent(
                    {
                        dataStartTime: '2020-01-01T00:00:00Z',
                        dataEndTime: 'now',
                        interval: 'P1000Y',
                    },
                    { now: NOW },
                ),
            ).toEqual({
                start: '2020-01-01T00:00:00Z',
                end: '2020-01-01T00:00:00Z',
            })
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

describe('layerRequestWindow', () => {
    const WINDOW_START = '2026-07-26T15:42:31Z'
    const CURSOR = '2026-08-25T15:42:31Z'
    const passthrough = { start: WINDOW_START, end: CURSOR, periodic: false }
    const time = (fields) => ({ enabled: true, type: 'requery', ...fields })
    const at = (fields, cursor = CURSOR) =>
        layerRequestWindow(time(fields), WINDOW_START, cursor)

    test('a layer without an interval requests the Time Control window', () => {
        expect(at({})).toEqual(passthrough)
        expect(at({ interval: 'garbage' })).toEqual(passthrough)
        expect(at({ interval: 'P0D' })).toEqual(passthrough)
    })

    test('a disabled or absent time block requests the window', () => {
        expect(
            layerRequestWindow(
                { enabled: false, interval: 'P1D' },
                WINDOW_START,
                CURSOR
            )
        ).toEqual(passthrough)
        expect(layerRequestWindow(null, WINDOW_START, CURSOR)).toEqual(
            passthrough
        )
    })

    test('P1D without an anchor requests the UTC day, ending on its last second', () => {
        expect(at({ interval: 'P1D' })).toEqual({
            start: '2026-08-25T00:00:00Z',
            end: '2026-08-25T23:59:59Z',
            periodic: true,
        })
    })

    test('P1Y, P1M and PT1H without an anchor follow UTC calendar boundaries', () => {
        expect(at({ interval: 'P1Y' })).toEqual({
            start: '2026-01-01T00:00:00Z',
            end: '2026-12-31T23:59:59Z',
            periodic: true,
        })
        expect(at({ interval: 'P1M' })).toEqual({
            start: '2026-08-01T00:00:00Z',
            end: '2026-08-31T23:59:59Z',
            periodic: true,
        })
        expect(at({ interval: 'PT1H' })).toEqual({
            start: '2026-08-25T15:00:00Z',
            end: '2026-08-25T15:59:59Z',
            periodic: true,
        })
    })

    test('a cursor exactly on a boundary opens the next period', () => {
        expect(at({ interval: 'P1D' }, '2026-08-25T00:00:00Z')).toEqual({
            start: '2026-08-25T00:00:00Z',
            end: '2026-08-25T23:59:59Z',
            periodic: true,
        })
    })

    test('P1M anchored on Jan 31 steps from the anchor without overlapping', () => {
        const monthly = (cursor) =>
            at(
                { interval: 'P1M', dataStartTime: '2025-01-31T00:00:00Z' },
                cursor
            )
        // Jan 31 + 1 month overflows to Mar 3; + 2 months lands on Mar 31.
        const feb = monthly('2025-02-15T12:00:00Z')
        const mar = monthly('2025-03-15T12:00:00Z')
        expect(feb).toEqual({
            start: '2025-01-31T00:00:00Z',
            end: '2025-03-02T23:59:59Z',
            periodic: true,
        })
        expect(mar).toEqual({
            start: '2025-03-03T00:00:00Z',
            end: '2025-03-30T23:59:59Z',
            periodic: true,
        })
        expect(new Date(feb.end).getTime()).toBeLessThan(
            new Date(mar.start).getTime()
        )
        expect(monthly('2025-04-01T00:00:00Z').start).toBe(
            '2025-03-31T00:00:00Z'
        )
    })

    test('an anchored cadence that is not a calendar unit steps from the anchor', () => {
        expect(
            at(
                { interval: 'P7D', dataStartTime: '2026-08-01T06:00:00Z' },
                '2026-08-15T00:00:00Z'
            )
        ).toEqual({
            start: '2026-08-08T06:00:00Z',
            end: '2026-08-15T05:59:59Z',
            periodic: true,
        })
    })

    test('a cursor before the anchor requests the window', () => {
        expect(
            at({ interval: 'P1D', dataStartTime: '2026-09-01T00:00:00Z' })
        ).toEqual(passthrough)
    })

    test('a "now - P1Y" dataStartTime anchors nothing', () => {
        expect(
            at({ interval: 'P1D', dataStartTime: 'now - P1Y' })
        ).toEqual({
            start: '2026-08-25T00:00:00Z',
            end: '2026-08-25T23:59:59Z',
            periodic: true,
        })
        expect(
            at({ interval: 'P7D', dataStartTime: 'now - P1Y' })
        ).toEqual(passthrough)
    })

    test('a cadence under an hour is a run of scenes, not a period', () => {
        expect(at({ interval: 'PT30M' })).toEqual(passthrough)
        expect(
            at({ interval: 'PT30M', dataStartTime: '2026-01-01T00:00:00Z' })
        ).toEqual(passthrough)
    })

    test('a week without an anchor is ambiguous and requests the window', () => {
        expect(at({ interval: 'P1W' })).toEqual(passthrough)
        expect(at({ interval: 'P7D' })).toEqual(passthrough)
    })

    test('a local layer requests the window', () => {
        expect(at({ interval: 'P1D', type: 'local' })).toEqual(passthrough)
    })

    test('an unreadable cursor or out-of-range period requests the window', () => {
        expect(
            layerRequestWindow(time({ interval: 'P1D' }), WINDOW_START, 'nope')
        ).toEqual({ start: WINDOW_START, end: 'nope', periodic: false })
        expect(
            at({ interval: 'P999999999Y', dataStartTime: '2020-01-01T00:00:00Z' })
        ).toEqual(passthrough)
    })
})

describe('isPeriodicRequest', () => {
    test('agrees with layerRequestWindow at a cursor', () => {
        const time = { enabled: true, interval: 'P1D', dataStartTime: '2026-09-01T00:00:00Z' }
        expect(isPeriodicRequest(time, '2026-08-25T00:00:00Z')).toBe(false)
        expect(isPeriodicRequest(time, '2026-09-02T00:00:00Z')).toBe(true)
    })

    test('without a cursor, says whether the layer is periodic at all', () => {
        expect(isPeriodicRequest({ enabled: true, interval: 'P1D' })).toBe(true)
        expect(isPeriodicRequest({ enabled: true, interval: 'P7D' })).toBe(false)
        expect(isPeriodicRequest({ enabled: true })).toBe(false)
    })
})
