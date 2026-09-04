import { describe, test, expect } from 'vitest'
import {
    coverageOverlap,
    hasDataIn,
    clipPeriodToCoverage,
} from '../coverageOverlap'

const request = (start: string | null, end: string) => ({ start, end })
const coverage = (start: string | null, end: string | null) => ({ start, end })

describe('coverageOverlap', () => {
    test('a request inside the coverage is the request', () => {
        expect(
            coverageOverlap(
                request('2016-01-01T00:00:00Z', '2016-06-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2017-01-01T00:00:00Z'),
            ),
        ).toEqual({
            start: '2016-01-01T00:00:00Z',
            end: '2016-06-01T00:00:00Z',
        })
    })

    // Only the covered part of a request can be on screen, so each end comes
    // from whichever bound is the tighter one.
    test('a coverage narrower than the request clips both ends', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-12-31T00:00:00Z'),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2016-12-31T00:00:00Z',
        })
    })

    test('a cursor short of the coverage end leaves the cursor as the end', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2016-03-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2016-03-01T00:00:00Z',
        })
    })

    // Point mode leaves no request start to speak of; the coverage then says
    // where the overlap begins.
    test('an absent request start takes the coverage start', () => {
        expect(
            coverageOverlap(
                request(null, '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', null),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2024-01-01T00:00:00Z',
        })
    })

    // Neither side bounds the past, so neither can the overlap.
    test('an absent request start and an absent coverage start stay unbounded', () => {
        expect(
            coverageOverlap(
                request(null, '2024-01-01T00:00:00Z'),
                coverage(null, '2016-01-01T00:00:00Z'),
            ),
        ).toEqual({ start: null, end: '2016-01-01T00:00:00Z' })
    })

    test('coverage running to an unbounded future ends at the cursor', () => {
        expect(
            coverageOverlap(
                request('2015-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
                coverage('2010-01-01T00:00:00Z', null),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2024-01-01T00:00:00Z',
        })
    })

    test('a cursor before the coverage overlaps nothing', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2014-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-01-01T00:00:00Z'),
            ),
        ).toBeNull()
    })

    test('a request starting after the coverage ends overlaps nothing', () => {
        expect(
            coverageOverlap(
                request('2020-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-01-01T00:00:00Z'),
            ),
        ).toBeNull()
    })

    // A request that reaches exactly the first instant of the coverage did
    // reach it, and that instant is the whole overlap.
    test('touching at a single instant is an overlap of that instant', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2015-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-01-01T00:00:00Z'),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2015-01-01T00:00:00Z',
        })
    })

    test('is null without a cursor it can read', () => {
        expect(
            coverageOverlap(
                request('2015-01-01T00:00:00Z', 'not a date'),
                coverage('2015-01-01T00:00:00Z', null),
            ),
        ).toBeNull()
    })

    // A bound that will not parse is no bound at all: it cannot be allowed to
    // narrow a range it says nothing about.
    test('an unreadable bound is read as unbounded', () => {
        expect(
            coverageOverlap(
                request('whenever', '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', 'whenever'),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2024-01-01T00:00:00Z',
        })
    })
})

describe('hasDataIn', () => {
    const june = { start: '2025-06-01T00:00:00Z', end: '2025-07-01T00:00:00Z' }

    test('is true for a period the coverage runs through', () => {
        expect(
            hasDataIn(
                coverage('2015-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                june,
            ),
        ).toBe(true)
    })

    test('is true for a period the coverage only partly fills', () => {
        expect(
            hasDataIn(
                coverage('2015-01-01T00:00:00Z', '2025-06-15T00:00:00Z'),
                june,
            ),
        ).toBe(true)
    })

    test('is false for a period after everything the layer holds', () => {
        expect(
            hasDataIn(
                coverage('2015-01-01T00:00:00Z', '2016-12-31T00:00:00Z'),
                june,
            ),
        ).toBe(false)
    })

    test('is false for a period before the layer starts', () => {
        expect(hasDataIn(coverage('2030-01-01T00:00:00Z', null), june)).toBe(
            false,
        )
    })

    // A period ends where the next one starts, so a period ending on the
    // first instant of the coverage holds none of it.
    test('is false for a period ending where the coverage starts', () => {
        expect(hasDataIn(coverage('2025-07-01T00:00:00Z', null), june)).toBe(
            false,
        )
    })

    // The mirror of the case above: a period starting on the coverage's last
    // instant still holds that instant.
    test('is true for a period starting where the coverage ends', () => {
        expect(
            hasDataIn(
                coverage('2015-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
                june,
            ),
        ).toBe(true)
    })

    test('is true when the coverage bounds nothing', () => {
        expect(hasDataIn(coverage(null, null), june)).toBe(true)
    })

    test('is false for a period it cannot read', () => {
        expect(
            hasDataIn(coverage(null, null), {
                start: 'not a date',
                end: '2025-07-01T00:00:00Z',
            }),
        ).toBe(false)
    })
})

describe('clipPeriodToCoverage', () => {
    const week = { start: '2025-01-08T00:00:00Z', end: '2025-01-15T00:00:00Z' }

    test('leaves a period the coverage runs through alone', () => {
        expect(
            clipPeriodToCoverage(
                week,
                coverage('2024-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
            ),
        ).toEqual({ ...week, endIsPeriodEnd: true })
    })

    // The layer's data stops partway through the period, so the period stops
    // there too rather than naming days it has nothing for.
    test('a coverage ending inside the period ends the period there', () => {
        expect(
            clipPeriodToCoverage(
                week,
                coverage('2025-01-01T00:00:00Z', '2025-01-09T23:59:59Z'),
            ),
        ).toEqual({
            start: '2025-01-08T00:00:00Z',
            end: '2025-01-09T23:59:59Z',
            endIsPeriodEnd: false,
        })
    })

    test('a coverage starting inside the period starts the period there', () => {
        expect(
            clipPeriodToCoverage(week, coverage('2025-01-10T00:00:00Z', null)),
        ).toEqual({
            start: '2025-01-10T00:00:00Z',
            end: '2025-01-15T00:00:00Z',
            endIsPeriodEnd: true,
        })
    })

    test('clips both ends at once', () => {
        expect(
            clipPeriodToCoverage(
                week,
                coverage('2025-01-10T00:00:00Z', '2025-01-12T00:00:00Z'),
            ),
        ).toEqual({
            start: '2025-01-10T00:00:00Z',
            end: '2025-01-12T00:00:00Z',
            endIsPeriodEnd: false,
        })
    })

    // A bound that says nothing cannot narrow a period, so an unbounded or
    // unreadable coverage leaves it whole.
    test('an unbounded or unreadable coverage clips nothing', () => {
        expect(clipPeriodToCoverage(week, coverage(null, null))).toEqual({
            ...week,
            endIsPeriodEnd: true,
        })
        expect(
            clipPeriodToCoverage(week, coverage('whenever', 'whenever')),
        ).toEqual({ ...week, endIsPeriodEnd: true })
    })
})
