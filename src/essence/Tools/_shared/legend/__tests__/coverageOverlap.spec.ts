import { describe, test, expect } from 'vitest'
import { coverageOverlap } from '../coverageOverlap'

const request = (start: string | null, end: string) => ({ start, end })
const coverage = (start: string | null, end: string | null) => ({ start, end })

describe('coverageOverlap', () => {
    // Only the covered part of a request can be on screen, so each end comes
    // from whichever bound is the tighter one — and a bound nobody set, or one
    // that will not parse, narrows nothing.
    test('each end of the overlap is the tighter of the two bounds', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-12-31T00:00:00Z'),
            ),
        ).toEqual({
            start: '2015-01-01T00:00:00Z',
            end: '2016-12-31T00:00:00Z',
        })
        expect(
            coverageOverlap(
                request(null, '2024-01-01T00:00:00Z'),
                coverage(null, '2016-01-01T00:00:00Z'),
            ),
        ).toEqual({ start: null, end: '2016-01-01T00:00:00Z' })
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

    // Nothing the layer holds was asked for, so there is nothing to report as
    // collected.
    test('a request that misses the coverage overlaps nothing', () => {
        expect(
            coverageOverlap(
                request('2010-01-01T00:00:00Z', '2014-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-01-01T00:00:00Z'),
            ),
        ).toBeNull()
        expect(
            coverageOverlap(
                request('2020-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
                coverage('2015-01-01T00:00:00Z', '2016-01-01T00:00:00Z'),
            ),
        ).toBeNull()
    })
})
