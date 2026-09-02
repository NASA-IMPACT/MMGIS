import { describe, test, expect } from 'vitest'
import { layerPeriodFor } from '../layerPeriod'

describe('layerPeriodFor calendar-aligned units', () => {
    test('P1Y is the UTC year holding the cursor', () => {
        expect(layerPeriodFor('P1Y', '2025-06-15T12:00:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025',
        })
    })

    test('P1M snaps to the UTC month holding the cursor', () => {
        expect(layerPeriodFor('P1M', '2025-06-15T12:00:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-06',
        })
        // The last instant of a month still belongs to that month, and the
        // first instant of the next one has already moved on.
        expect(layerPeriodFor('P1M', '2025-06-30T23:59:59Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-06',
        })
        expect(layerPeriodFor('P1M', '2025-07-01T00:00:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-07',
        })
    })

    test('P1D is the UTC day holding the cursor', () => {
        expect(layerPeriodFor('P1D', '2025-06-15T23:30:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-06-15',
        })
    })

    test('pads single-digit months and days', () => {
        expect(layerPeriodFor('P1M', '2025-01-05T00:00:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-01',
        })
        expect(layerPeriodFor('P1D', '2025-01-05T00:00:00Z', null)).toEqual({
            kind: 'calendar',
            label: '2025-01-05',
        })
    })
})

describe('layerPeriodFor anchored durations', () => {
    test('P7D steps from the anchor to the week holding the cursor', () => {
        expect(
            layerPeriodFor(
                'P7D',
                '2025-01-10T06:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-01-08T00:00:00.000Z',
            end: '2025-01-15T00:00:00.000Z',
        })
    })

    test('P1W is a week like P7D, not a calendar unit', () => {
        expect(
            layerPeriodFor(
                'P1W',
                '2025-01-10T06:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-01-08T00:00:00.000Z',
            end: '2025-01-15T00:00:00.000Z',
        })
    })

    test('a compound month-and-day duration steps by calendar', () => {
        // Each step is measured from the anchor, so two P1M10D steps put the
        // month on first and count the days off the month they landed on.
        expect(
            layerPeriodFor(
                'P1M10D',
                '2025-03-01T00:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-02-11T00:00:00.000Z',
            end: '2025-03-21T00:00:00.000Z',
        })
    })

    test('PT6H steps in sub-day periods', () => {
        expect(
            layerPeriodFor(
                'PT6H',
                '2025-01-01T13:10:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-01-01T12:00:00.000Z',
            end: '2025-01-01T18:00:00.000Z',
        })
    })

    test('a cursor sitting exactly on a boundary starts that period', () => {
        expect(
            layerPeriodFor(
                'P7D',
                '2025-01-08T00:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-01-08T00:00:00.000Z',
            end: '2025-01-15T00:00:00.000Z',
        })
    })

    test('a cursor inside the first period returns the anchor period', () => {
        expect(
            layerPeriodFor(
                'P7D',
                '2025-01-02T00:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2025-01-01T00:00:00.000Z',
            end: '2025-01-08T00:00:00.000Z',
        })
    })

    test('months step by calendar, not by a fixed number of days', () => {
        // Six 2-month steps from 2024-01-01 land on 2025-01-01 by calendar.
        // Stepping by a fixed 60 days would drift to 2024-12-26 and report a
        // period that starts in December.
        expect(
            layerPeriodFor(
                'P2M',
                '2024-12-15T00:00:00Z',
                '2024-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2024-11-01T00:00:00.000Z',
            end: '2025-01-01T00:00:00.000Z',
        })
    })

    test('years step by calendar across a leap year', () => {
        expect(
            layerPeriodFor(
                'P2Y',
                '2027-05-01T00:00:00Z',
                '2020-01-01T00:00:00Z',
            ),
        ).toEqual({
            kind: 'range',
            start: '2026-01-01T00:00:00.000Z',
            end: '2028-01-01T00:00:00.000Z',
        })
    })

    test('is null with no anchor to step from', () => {
        expect(layerPeriodFor('P7D', '2025-01-10T00:00:00Z', null)).toBeNull()
        expect(
            layerPeriodFor('P7D', '2025-01-10T00:00:00Z', 'not a date'),
        ).toBeNull()
    })

    test('is null for a cursor earlier than the anchor', () => {
        expect(
            layerPeriodFor(
                'P7D',
                '2019-01-10T00:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toBeNull()
    })
})

describe('layerPeriodFor rejections', () => {
    test('is null for an unparseable interval', () => {
        expect(
            layerPeriodFor(
                'every so often',
                '2025-06-15T00:00:00Z',
                '2020-01-01T00:00:00Z',
            ),
        ).toBeNull()
    })

    // A zero-length period contains nothing and would never advance.
    test('is null for a zero-length interval', () => {
        expect(
            layerPeriodFor(
                'P0D',
                '2025-06-15T00:00:00Z',
                '2020-01-01T00:00:00Z',
            ),
        ).toBeNull()
    })

    // A cadence that needs more steps than any mission would run is a bad
    // config, not a period: stop stepping rather than spin on it.
    test('is null when stepping to the cursor would never end', () => {
        expect(
            layerPeriodFor(
                'P1M1D',
                '9999-01-01T00:00:00Z',
                '1000-01-01T00:00:00Z',
            ),
        ).toBeNull()
    })

    test('is null without a cursor to place', () => {
        expect(layerPeriodFor('P1M', null, '2020-01-01T00:00:00Z')).toBeNull()
        expect(
            layerPeriodFor('P1M', 'not a date', '2020-01-01T00:00:00Z'),
        ).toBeNull()
    })
})
