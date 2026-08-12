import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
    generateTimeTicks,
    getTimeStep,
    clampDate,
    formatDateByMode,
    stepTime,
    snapMonthToRange,
} from '../../src/essence/Tools/Timeline/lib/utils/timeUtils'

const iso = (d) => d.toISOString()

// The timeline displays UTC everywhere, so every helper has to compute in UTC
// too. Running these under a non-UTC zone is what makes that observable: on a
// UTC machine local and UTC arithmetic agree and the assertions pass either way.
const withTimeZone = (zone) => {
    const original = process.env.TZ
    beforeAll(() => {
        process.env.TZ = zone
    })
    afterAll(() => {
        process.env.TZ = original
    })
}

describe('getTimeStep', () => {
    it('maps every time mode to a one-unit step', () => {
        expect(getTimeStep('YEAR')).toEqual({ unit: 'years', value: 1 })
        expect(getTimeStep('MONTH')).toEqual({ unit: 'months', value: 1 })
        expect(getTimeStep('DAY')).toEqual({ unit: 'days', value: 1 })
        expect(getTimeStep('HOUR')).toEqual({ unit: 'hours', value: 1 })
    })
})

describe('generateTimeTicks', () => {
    it('keeps every tick inside the domain', () => {
        const start = new Date('2026-07-01T00:00:00Z')
        const end = new Date('2026-07-31T00:00:00Z')

        for (const mode of ['YEAR', 'MONTH', 'DAY', 'HOUR']) {
            const ticks = generateTimeTicks(start, end, mode)
            for (const tick of ticks) {
                expect(tick.getTime()).toBeGreaterThanOrEqual(start.getTime())
                expect(tick.getTime()).toBeLessThanOrEqual(end.getTime())
            }
        }
    })

    it('closes the axis on the domain end exactly once', () => {
        const start = new Date('2026-01-01T00:00:00Z')
        const end = new Date('2026-01-05T00:00:00Z')
        const ticks = generateTimeTicks(start, end, 'DAY')

        expect(iso(ticks[ticks.length - 1])).toBe(iso(end))
        expect(ticks.filter((t) => t.getTime() === end.getTime())).toHaveLength(1)
    })

    it('returns a single tick when the domain is empty or inverted', () => {
        const instant = new Date('2026-03-01T00:00:00Z')
        expect(generateTimeTicks(instant, instant, 'DAY')).toEqual([instant])

        const earlier = new Date('2026-02-01T00:00:00Z')
        expect(generateTimeTicks(instant, earlier, 'DAY')).toEqual([instant])
    })

    it('does not emit a boundary label left of the domain when the range is shorter than the unit', () => {
        const start = new Date('2026-07-01T00:00:00Z')
        const end = new Date('2026-07-31T00:00:00Z')
        const ticks = generateTimeTicks(start, end, 'YEAR')

        // 2026-01-01 snaps before the domain and must not appear.
        expect(ticks.some((t) => t.getUTCMonth() === 0 && t.getUTCDate() === 1)).toBe(false)
    })

    it('honours maxTicks for a long range', () => {
        const start = new Date('2000-01-01T00:00:00Z')
        const end = new Date('2026-01-01T00:00:00Z')
        const ticks = generateTimeTicks(start, end, 'HOUR', 50)

        expect(ticks.length).toBeLessThanOrEqual(51) // maxTicks + the end tick
        expect(ticks.length).toBeGreaterThan(1)
    })

    it('terminates for a multi-decade hourly range', () => {
        const start = new Date('1990-01-01T00:00:00Z')
        const end = new Date('2026-01-01T00:00:00Z')
        expect(() => generateTimeTicks(start, end, 'HOUR')).not.toThrow()
    })
})

describe('UTC handling away from UTC', () => {
    // UTC+9, no daylight saving: a local day boundary sits at 15:00Z.
    withTimeZone('Asia/Tokyo')

    it('snaps day ticks to UTC midnight, not local midnight', () => {
        const start = new Date('2026-08-01T00:00:00Z')
        const end = new Date('2026-08-05T00:00:00Z')

        for (const tick of generateTimeTicks(start, end, 'DAY')) {
            expect(tick.getUTCHours()).toBe(0)
        }
    })

    it('labels an instant with its UTC date', () => {
        const instant = new Date('2026-08-03T00:00:00Z')
        expect(formatDateByMode(instant, 'DAY')).toBe('Aug 3')
        expect(formatDateByMode(instant, 'HOUR')).toBe('00:00')
    })
})

describe('stepTime', () => {
    it('advances and rewinds by one unit of the mode', () => {
        const from = new Date('2026-08-03T12:00:00Z')
        expect(iso(stepTime(from, 'DAY', 1))).toBe('2026-08-04T12:00:00.000Z')
        expect(iso(stepTime(from, 'DAY', -1))).toBe('2026-08-02T12:00:00.000Z')
        expect(iso(stepTime(from, 'HOUR', 1))).toBe('2026-08-03T13:00:00.000Z')
        expect(iso(stepTime(from, 'MONTH', 1))).toBe('2026-09-03T12:00:00.000Z')
        expect(iso(stepTime(from, 'YEAR', 1))).toBe('2027-08-03T12:00:00.000Z')
    })

    describe('across a daylight-saving boundary', () => {
        // US DST starts 2026-03-08; a local "one day" step spans 23 hours there.
        withTimeZone('America/New_York')

        it('keeps a day step exactly 24 hours', () => {
            const before = new Date('2026-03-07T12:00:00Z')
            expect(iso(stepTime(before, 'DAY', 1))).toBe('2026-03-08T12:00:00.000Z')
        })
    })
})

describe('snapMonthToRange', () => {
    // The timeline covers 2024-06-15 through 2026-03-20.
    const start = new Date('2024-06-15T00:00:00Z')
    const end = new Date('2026-03-20T00:00:00Z')

    it('leaves a covered month alone', () => {
        expect(snapMonthToRange(2025, 0, start, end)).toBe(0)
        expect(snapMonthToRange(2025, 11, start, end)).toBe(11)
        expect(snapMonthToRange(2024, 8, start, end)).toBe(8)
    })

    it('snaps up to the first covered month of the start year', () => {
        expect(snapMonthToRange(2024, 0, start, end)).toBe(5) // June
    })

    it('snaps down to the last covered month of the end year', () => {
        expect(snapMonthToRange(2026, 11, start, end)).toBe(2) // March
    })

    describe('away from UTC', () => {
        withTimeZone('Asia/Tokyo')

        it('takes the range bounds from their UTC months', () => {
            // 2024-07-01T00:00Z is still June locally at UTC-something and
            // already July in Tokyo; the UTC month is what bounds the picker.
            const utcStart = new Date('2024-07-01T00:00:00Z')
            expect(snapMonthToRange(2024, 0, utcStart, end)).toBe(6) // July
        })
    })
})

describe('clampDate', () => {
    const min = new Date('2026-01-01T00:00:00Z')
    const max = new Date('2026-12-31T00:00:00Z')

    it('returns the bound when the date falls outside the range', () => {
        expect(clampDate(new Date('2025-01-01T00:00:00Z'), min, max)).toBe(min)
        expect(clampDate(new Date('2027-01-01T00:00:00Z'), min, max)).toBe(max)
    })

    it('passes an in-range date through untouched', () => {
        const inside = new Date('2026-06-01T00:00:00Z')
        expect(clampDate(inside, min, max)).toBe(inside)
    })
})
