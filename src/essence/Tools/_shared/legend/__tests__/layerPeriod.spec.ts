import { describe, test, expect } from 'vitest'
import { layerPeriodFor } from '../layerPeriod'

// A period runs from its first instant up to the first instant of the next
// one, so a caller can tell whether a layer has any data inside it.
describe('layerPeriodFor', () => {
    // Calendar units snap to the calendar: December's next boundary is the
    // following January, and months are not a fixed number of days.
    test('a calendar unit is the UTC month, day or year holding the cursor', () => {
        expect(layerPeriodFor('P1M', '2025-12-09T00:00:00Z', null)).toEqual({
            start: '2025-12-01T00:00:00.000Z',
            end: '2026-01-01T00:00:00.000Z',
        })
        expect(layerPeriodFor('P1D', '2025-06-15T23:30:00Z', null)).toEqual({
            start: '2025-06-15T00:00:00.000Z',
            end: '2025-06-16T00:00:00.000Z',
        })
        expect(layerPeriodFor('P1Y', '2025-06-15T12:00:00Z', null)).toEqual({
            start: '2025-01-01T00:00:00.000Z',
            end: '2026-01-01T00:00:00.000Z',
        })
    })

    // An off-calendar cadence has no boundary of its own to snap to, so it is
    // stepped from the layer's first scene until it reaches the cursor.
    test('an off-calendar cadence steps from its anchor to the cursor', () => {
        expect(
            layerPeriodFor(
                'P7D',
                '2025-01-10T06:00:00Z',
                '2025-01-01T00:00:00Z',
            ),
        ).toEqual({
            start: '2025-01-08T00:00:00.000Z',
            end: '2025-01-15T00:00:00.000Z',
        })
        // With nothing to step from, there are no periods to name.
        expect(layerPeriodFor('P7D', '2025-01-10T06:00:00Z', null)).toBeNull()
    })

    // An interval under an hour is not a cadence of periods but a run of
    // individually timestamped scenes, so there is no period to name. Nor is
    // an unreadable or zero-length interval one.
    test('is null for an interval that names no period', () => {
        const cursor = '2025-01-01T05:30:00Z'
        const anchor = '2025-01-01T00:00:00Z'
        expect(layerPeriodFor('PT30M', cursor, anchor)).toBeNull()
        expect(layerPeriodFor('P0D', cursor, anchor)).toBeNull()
        expect(layerPeriodFor('every so often', cursor, anchor)).toBeNull()
        expect(layerPeriodFor('PT1H', cursor, anchor)).toEqual({
            start: '2025-01-01T05:00:00.000Z',
            end: '2025-01-01T06:00:00.000Z',
        })
    })
})
