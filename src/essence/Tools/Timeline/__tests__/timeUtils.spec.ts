import { describe, test, expect } from 'vitest'
import { tickModeForSpan, contextTicks, formatContext, generateTimeTicks } from '../lib/utils/timeUtils'

/**
 * The axis labels follow how much time is on screen, not the step mode: the
 * finest unit whose ticks still fit the width is the one drawn.
 */
describe('tickModeForSpan', () => {
    const start = new Date('2025-01-01T00:00:00Z')
    const after = (ms: number) => new Date(start.getTime() + ms)
    const HOUR = 3600 * 1000
    const DAY = 24 * HOUR

    test('labels hours while a view of a day or so is on screen', () => {
        expect(tickModeForSpan(start, after(DAY), 10)).toBe('HOUR')
    })

    test('labels days across a few weeks', () => {
        expect(tickModeForSpan(start, after(30 * DAY), 10)).toBe('DAY')
    })

    test('labels months across a couple of years', () => {
        expect(tickModeForSpan(start, after(2 * 365 * DAY), 10)).toBe('MONTH')
    })

    test('labels years across decades', () => {
        expect(tickModeForSpan(start, after(20 * 365 * DAY), 10)).toBe('YEAR')
    })

    test('a wider axis keeps a finer unit over the same span', () => {
        const span = after(10 * DAY)
        expect(tickModeForSpan(start, span, 4)).toBe('DAY')
        expect(tickModeForSpan(start, span, 20)).toBe('HOUR')
    })

    test('an empty or inverted span labels hours', () => {
        expect(tickModeForSpan(start, start, 10)).toBe('HOUR')
        expect(tickModeForSpan(after(DAY), start, 10)).toBe('HOUR')
    })
})

/**
 * The top bar names the period the bottom ticks fall in, one unit coarser, so
 * the two bars together read as a whole date. A label is pinned at the view's
 * left edge so a view inside a single period still says which one.
 */
describe('contextTicks', () => {
    const at = (iso: string) => new Date(iso)
    const iso = (dates: Date[]) => dates.map((d) => d.toISOString())

    test('hourly ticks are placed in their day, and each day boundary is marked', () => {
        const { mode, ticks } = contextTicks(
            at('2020-03-02T18:00:00Z'),
            at('2020-03-04T06:00:00Z'),
            'HOUR',
            0
        )

        expect(mode).toBe('DAY')
        expect(iso(ticks)).toEqual([
            '2020-03-02T18:00:00.000Z',
            '2020-03-03T00:00:00.000Z',
            '2020-03-04T00:00:00.000Z',
        ])
    })

    test('a view inside one day still names that day', () => {
        const { ticks } = contextTicks(
            at('2020-03-02T08:00:00Z'),
            at('2020-03-02T16:00:00Z'),
            'HOUR',
            0
        )

        expect(iso(ticks)).toEqual(['2020-03-02T08:00:00.000Z'])
    })

    test('daily ticks are placed in their month, monthly ticks in their year', () => {
        expect(
            contextTicks(at('2020-03-20T00:00:00Z'), at('2020-04-10T00:00:00Z'), 'DAY', 0)
        ).toEqual({
            mode: 'MONTH',
            ticks: [at('2020-03-20T00:00:00Z'), at('2020-04-01T00:00:00Z')],
        })
        expect(
            contextTicks(at('2020-06-01T00:00:00Z'), at('2021-06-01T00:00:00Z'), 'MONTH', 0)
                .mode
        ).toBe('YEAR')
    })

    test('yearly ticks are complete on their own, so nothing is added above', () => {
        expect(
            contextTicks(at('2000-01-01T00:00:00Z'), at('2020-01-01T00:00:00Z'), 'YEAR', 0)
        ).toEqual({ mode: null, ticks: [] })
    })

    test('the pinned label gives way to a boundary too close to share the space', () => {
        const start = at('2020-03-02T22:00:00Z')
        const end = at('2020-03-03T12:00:00Z')

        expect(iso(contextTicks(start, end, 'HOUR', 3 * 3600 * 1000).ticks)).toEqual([
            '2020-03-03T00:00:00.000Z',
        ])
        expect(contextTicks(start, end, 'HOUR', 3600 * 1000).ticks).toHaveLength(2)
    })

    test('a boundary too close to the right edge to fit its label is left out', () => {
        const start = at('2020-03-01T00:00:00Z')
        const end = at('2020-03-03T02:00:00Z')

        expect(iso(contextTicks(start, end, 'HOUR', 3 * 3600 * 1000).ticks)).toEqual([
            '2020-03-01T00:00:00.000Z',
            '2020-03-02T00:00:00.000Z',
        ])
        expect(contextTicks(start, end, 'HOUR', 3600 * 1000).ticks).toHaveLength(3)
    })

    test('a boundary on the left edge is labelled once', () => {
        const { ticks } = contextTicks(
            at('2020-03-02T00:00:00Z'),
            at('2020-03-02T12:00:00Z'),
            'HOUR',
            0
        )

        expect(iso(ticks)).toEqual(['2020-03-02T00:00:00.000Z'])
    })
})

describe('formatContext', () => {
    const date = new Date('2020-03-02T18:30:00Z')

    test('names the day, month or year in full', () => {
        expect(formatContext(date, 'DAY')).toBe('Mar 2, 2020')
        expect(formatContext(date, 'MONTH')).toBe('Mar 2020')
        expect(formatContext(date, 'YEAR')).toBe('2020')
    })
})

describe('generateTimeTicks', () => {
    test('marks only unit boundaries, never the view edge between them', () => {
        const ticks = generateTimeTicks(
            new Date('2020-03-01T00:00:00Z'),
            new Date('2020-03-04T12:00:00Z'),
            'DAY',
            10
        )

        expect(ticks.map((d) => d.toISOString())).toEqual([
            '2020-03-01T00:00:00.000Z',
            '2020-03-02T00:00:00.000Z',
            '2020-03-03T00:00:00.000Z',
            '2020-03-04T00:00:00.000Z',
        ])
    })
})
