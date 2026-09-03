import { describe, test, expect } from 'vitest'
import { parseISODuration } from '../../../../Basics/TimeControl_/layerTimePolicy'
import { formatAtPrecision, formatPeriodEnd } from '../datePrecision'

const at = (interval: string | null, instant: string) =>
    formatAtPrecision(
        interval === null ? null : parseISODuration(interval),
        instant,
    )

describe('formatAtPrecision', () => {
    test('years print as a year', () => {
        expect(at('P1Y', '2026-07-03T06:12:22Z')).toBe('2026')
        expect(at('P2Y', '2026-07-03T06:12:22Z')).toBe('2026')
    })

    test('months print as a month', () => {
        expect(at('P1M', '2026-07-03T06:12:22Z')).toBe('2026-07')
        expect(at('P6M', '2026-07-03T06:12:22Z')).toBe('2026-07')
    })

    test('days and weeks print as a day', () => {
        expect(at('P1D', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
        expect(at('P7D', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
        expect(at('P1W', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
    })

    test('hours print to the hour', () => {
        expect(at('PT1H', '2026-07-03T06:12:22Z')).toBe('2026-07-03 06:00Z')
        expect(at('PT6H', '2026-07-03T06:12:22Z')).toBe('2026-07-03 06:00Z')
    })

    test('minutes and seconds print the whole timestamp', () => {
        expect(at('PT30M', '2026-07-03T06:12:22Z')).toBe('2026-07-03T06:12:22Z')
        expect(at('PT1S', '2026-07-03T06:12:22Z')).toBe('2026-07-03T06:12:22Z')
    })

    // The smallest unit in the duration is what a reader can distinguish, so
    // a compound duration prints to its finest part.
    test('a compound duration takes its smallest unit', () => {
        expect(at('P1M10D', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
        expect(at('P1DT6H', '2026-07-03T06:12:22Z')).toBe('2026-07-03 06:00Z')
    })

    test('no interval prints a day', () => {
        expect(at(null, '2026-07-03T06:12:22Z')).toBe('2026-07-03')
    })

    // parseISODuration returns null for anything it cannot read, which lands
    // on the same day precision as no interval at all.
    test('an unparseable interval prints a day', () => {
        expect(at('every so often', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
    })

    test('pads single-digit parts', () => {
        expect(at('P1M', '2026-01-05T04:07:09Z')).toBe('2026-01')
        expect(at('P1D', '2026-01-05T04:07:09Z')).toBe('2026-01-05')
        expect(at('PT1H', '2026-01-05T04:07:09Z')).toBe('2026-01-05 04:00Z')
        expect(at('PT1M', '2026-01-05T04:07:09Z')).toBe('2026-01-05T04:07:09Z')
    })

    // Nothing prints finer than a second, so a fraction is dropped rather
    // than rounded up into the next one.
    test('a fractional second prints its whole second', () => {
        expect(at('PT1S', '2026-07-03T06:12:22.750Z')).toBe(
            '2026-07-03T06:12:22Z',
        )
    })

    // Every date on a row is UTC, so an instant written at an offset prints
    // on the UTC day it falls on rather than its own local one.
    test('an instant carrying an offset prints in UTC', () => {
        expect(at('P1D', '2025-06-01T01:00:00+02:00')).toBe('2025-05-31')
    })

    test('is null for an instant it cannot read', () => {
        expect(at('P1D', 'not a date')).toBeNull()
        expect(formatAtPrecision(null, null)).toBeNull()
    })
})

describe('formatPeriodEnd', () => {
    // A period's end is where the next one starts, so printing it raw makes a
    // seven-day period read as eight days.
    test('a P7D period ends on its seventh day', () => {
        expect(
            formatPeriodEnd(parseISODuration('P7D'), '2025-06-08T00:00:00.000Z'),
        ).toBe('2025-06-07')
    })

    test('an hourly period ends on its last hour', () => {
        expect(
            formatPeriodEnd(
                parseISODuration('PT6H'),
                '2025-01-01T18:00:00.000Z',
            ),
        ).toBe('2025-01-01 17:00Z')
    })

    test('is null for an end it cannot read', () => {
        expect(formatPeriodEnd(parseISODuration('P7D'), 'not a date')).toBeNull()
    })
})
