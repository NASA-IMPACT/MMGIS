import { describe, test, expect, vi } from 'vitest'

/**
 * The Data Time Interval arithmetic behind a periodic layer's divisions and
 * its cadence stepping.
 *
 * The process timezone is pinned behind UTC, so arithmetic that leans on the
 * host's calendar surfaces as a wrong instant here rather than passing on a
 * UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import {
    addSteps,
    parseDuration,
    shortestStepMs,
    stepIndexAtOrBefore,
} from '../lib/utils/duration'

const MS_DAY = 24 * 3600 * 1000
const at = (value: string) => new Date(value)

describe('parseDuration', () => {
    test('reads day, week, month and time components', () => {
        expect(parseDuration('P1D')).toMatchObject({ days: 1 })
        expect(parseDuration('P7D')).toMatchObject({ days: 7 })
        expect(parseDuration('P2W')).toMatchObject({ weeks: 2 })
        expect(parseDuration('P1M')).toMatchObject({ months: 1 })
        expect(parseDuration('P1Y2M')).toMatchObject({ years: 1, months: 2 })
        expect(parseDuration('PT6H')).toMatchObject({ hours: 6 })
        expect(parseDuration(' P1D ')).toMatchObject({ days: 1 })
    })

    test('names no duration for anything else', () => {
        for (const value of ['', 'P', 'PT', 'P0D', '1D', 'daily', 'P1DT', `P${'9'.repeat(400)}D`, null, undefined, 7])
            expect(parseDuration(value)).toBeNull()
    })
})

describe('addSteps', () => {
    test('steps whole days and weeks in UTC', () => {
        const anchor = at('2024-03-09T00:00:00Z')
        // Across the US daylight-saving change on 10 March.
        expect(addSteps(anchor, parseDuration('P1D')!, 2).toISOString()).toBe(
            '2024-03-11T00:00:00.000Z'
        )
        expect(addSteps(anchor, parseDuration('P7D')!, -1).toISOString()).toBe(
            '2024-03-02T00:00:00.000Z'
        )
    })

    test('keeps a monthly cadence on its day, clamped to short months', () => {
        const anchor = at('2024-01-31T00:00:00Z')
        const month = parseDuration('P1M')!
        expect(
            [1, 2, 3, 13].map((n) => addSteps(anchor, month, n).toISOString())
        ).toEqual([
            '2024-02-29T00:00:00.000Z',
            '2024-03-31T00:00:00.000Z',
            '2024-04-30T00:00:00.000Z',
            '2025-02-28T00:00:00.000Z',
        ])
    })

    test('keeps a yearly cadence from a leap day', () => {
        const anchor = at('2024-02-29T12:00:00Z')
        expect(addSteps(anchor, parseDuration('P1Y')!, 1).toISOString()).toBe(
            '2025-02-28T12:00:00.000Z'
        )
    })
})

describe('stepIndexAtOrBefore', () => {
    const anchor = at('2024-01-31T00:00:00Z')
    const month = parseDuration('P1M')!

    test('finds the step on or before an instant', () => {
        expect(stepIndexAtOrBefore(anchor, month, anchor)).toBe(0)
        expect(stepIndexAtOrBefore(anchor, month, at('2024-02-28T23:59:59Z'))).toBe(0)
        expect(stepIndexAtOrBefore(anchor, month, at('2024-02-29T00:00:00Z'))).toBe(1)
        expect(stepIndexAtOrBefore(anchor, month, at('2034-01-30T00:00:00Z'))).toBe(119)
    })

    test('counts backwards before the anchor', () => {
        expect(stepIndexAtOrBefore(anchor, month, at('2023-12-31T00:00:00Z'))).toBe(-1)
        expect(stepIndexAtOrBefore(anchor, month, at('2023-12-30T00:00:00Z'))).toBe(-2)
    })
})

describe('shortestStepMs', () => {
    test('takes a month at its shortest', () => {
        expect(shortestStepMs(parseDuration('P1M')!)).toBe(28 * MS_DAY)
        expect(shortestStepMs(parseDuration('P7D')!)).toBe(7 * MS_DAY)
    })
})
