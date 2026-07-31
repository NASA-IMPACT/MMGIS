import { describe, it, expect } from 'vitest'
import {
    generateTimeTicks,
    getTimeStep,
    clampDate,
} from '../../src/essence/Tools/Timeline/lib/utils/timeUtils'

const iso = (d) => d.toISOString()

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
