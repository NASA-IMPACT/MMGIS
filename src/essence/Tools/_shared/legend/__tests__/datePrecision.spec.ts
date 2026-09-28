import { describe, test, expect } from 'vitest'
import { type Duration } from '../../adapters/mmgisAPI'
import { formatAtPrecision } from '../datePrecision'

// An interval as `layers:getTemporalExtent` answers it: core has already
// parsed the ISO duration, so each unit arrives as a count.
const duration = (units: Partial<Duration>): Duration => ({
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    ...units,
})

const at = (interval: Duration | null, instant: string) =>
    formatAtPrecision(interval, instant)

describe('formatAtPrecision', () => {
    // A date prints only as precisely as the layer's cadence can distinguish,
    // and a compound duration prints to its finest part. Anything finer than
    // an hour prints the whole timestamp.
    test('an instant prints at the precision of its interval', () => {
        const instant = '2026-07-03T06:12:22Z'
        expect(at(duration({ years: 1 }), instant)).toBe('2026')
        expect(at(duration({ months: 6 }), instant)).toBe('2026-07')
        expect(at(duration({ weeks: 1 }), instant)).toBe('2026-07-03')
        expect(at(duration({ hours: 6 }), instant)).toBe('2026-07-03T06:00Z')
        expect(at(duration({ days: 1, hours: 6 }), instant)).toBe(
            '2026-07-03T06:00Z',
        )
        expect(at(duration({ minutes: 30 }), instant)).toBe(
            '2026-07-03T06:12:22Z',
        )
    })

    // Core answers null for a layer with no interval and for one whose
    // interval it cannot read; both land on a day.
    test('no interval prints a day', () => {
        expect(at(null, '2026-07-03T06:12:22Z')).toBe('2026-07-03')
    })

    // Every date on a row is UTC, so an instant written at an offset prints
    // on the UTC day it falls on rather than its own local one.
    test('an instant carrying an offset prints in UTC', () => {
        expect(at(duration({ days: 1 }), '2025-06-01T01:00:00+02:00')).toBe(
            '2025-05-31',
        )
    })
})
