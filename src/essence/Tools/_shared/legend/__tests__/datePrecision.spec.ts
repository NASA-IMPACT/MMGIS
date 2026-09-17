import { describe, test, expect } from 'vitest'
import { parseISODuration } from '../../../../Basics/TimeControl_/layerTimePolicy'
import { formatAtPrecision } from '../datePrecision'

const at = (interval: string | null, instant: string) =>
    formatAtPrecision(
        interval === null ? null : parseISODuration(interval),
        instant,
    )

describe('formatAtPrecision', () => {
    // A date prints only as precisely as the layer's cadence can distinguish,
    // and a compound duration prints to its finest part. Anything finer than
    // an hour prints the whole timestamp.
    test('an instant prints at the precision of its interval', () => {
        expect(at('P1Y', '2026-07-03T06:12:22Z')).toBe('2026')
        expect(at('P6M', '2026-07-03T06:12:22Z')).toBe('2026-07')
        expect(at('P1W', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
        expect(at('PT6H', '2026-07-03T06:12:22Z')).toBe('2026-07-03 06:00Z')
        expect(at('P1DT6H', '2026-07-03T06:12:22Z')).toBe('2026-07-03 06:00Z')
        expect(at('PT30M', '2026-07-03T06:12:22Z')).toBe('2026-07-03T06:12:22Z')
    })

    // No interval, and an interval that will not parse, both land on a day.
    test('an unreadable or absent interval prints a day', () => {
        expect(at(null, '2026-07-03T06:12:22Z')).toBe('2026-07-03')
        expect(at('every so often', '2026-07-03T06:12:22Z')).toBe('2026-07-03')
    })

    // Every date on a row is UTC, so an instant written at an offset prints
    // on the UTC day it falls on rather than its own local one.
    test('an instant carrying an offset prints in UTC', () => {
        expect(at('P1D', '2025-06-01T01:00:00+02:00')).toBe('2025-05-31')
    })
})
