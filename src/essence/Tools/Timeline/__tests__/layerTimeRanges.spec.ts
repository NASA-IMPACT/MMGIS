import { describe, test, expect, vi } from 'vitest'

/**
 * A sparse layer — one with data on a handful of scattered days rather than
 * continuously across its extent — is configured by listing those days. The
 * timeline then draws one box per listed day instead of a single bar spanning
 * the whole extent.
 *
 * The process timezone is pinned behind UTC so that a resolver which snapped
 * days in local time would surface as a wrong day here, rather than passing on
 * a UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/Los_Angeles'
})

import { resolveLayerTimeRanges } from '../lib/utils/timeUtils'

const FALLBACK_START = new Date('2024-01-01T00:00:00Z')
const FALLBACK_END = new Date('2024-12-31T00:00:00Z')

const resolve = (time: unknown) =>
    resolveLayerTimeRanges(
        time as Parameters<typeof resolveLayerTimeRanges>[0],
        FALLBACK_START,
        FALLBACK_END
    )

describe('resolveLayerTimeRanges', () => {
    test('gives a sparse layer one range per listed day', () => {
        const ranges = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(ranges).toHaveLength(2)
    })

    test('covers a listed day from its first to its last UTC instant', () => {
        const [range] = resolve({
            enabled: true,
            dataDates: ['2020-03-04'],
        })

        expect(range.start.toISOString()).toBe('2020-03-04T00:00:00.000Z')
        expect(range.end.toISOString()).toBe('2020-03-04T23:59:59.999Z')
    })

    test('labels a listed day by the day itself, not as a range', () => {
        const [range] = resolve({
            enabled: true,
            dataDates: ['2020-03-04'],
        })

        expect(range.label).toBe('2020-03-04')
    })

    test('drops entries that are not dates and keeps the rest', () => {
        const ranges = resolve({
            enabled: true,
            dataDates: ['2020-03-04', 'not a date', '', '2020-07-19'],
        })

        expect(ranges.map((r) => r.label)).toEqual(['2020-03-04', '2020-07-19'])
    })

    test('reads days spaced out the way a comma-separated list leaves them', () => {
        // The Configure field splits its text on commas without trimming, so a
        // list written "2020-03-04, 2020-07-19" reaches here space-padded.
        const ranges = resolve({
            enabled: true,
            dataDates: ['2020-03-04', ' 2020-07-19', '2020-11-02 '],
        })

        expect(ranges.map((r) => r.label)).toEqual([
            '2020-03-04',
            '2020-07-19',
            '2020-11-02',
        ])
    })

    test('orders the days ascending however they were listed', () => {
        const ranges = resolve({
            enabled: true,
            dataDates: ['2020-07-19', '2020-01-02', '2020-03-04'],
        })

        expect(ranges.map((r) => r.label)).toEqual([
            '2020-01-02',
            '2020-03-04',
            '2020-07-19',
        ])
    })

    test('spans the configured extent when no days are listed', () => {
        const ranges = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(ranges).toHaveLength(1)
        expect(ranges[0].start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
        expect(ranges[0].end.toISOString()).toBe('2020-12-31T00:00:00.000Z')
    })

    test('falls back to the extent when every listed day is unreadable', () => {
        const ranges = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
            dataDates: ['nonsense', ''],
        })

        expect(ranges).toHaveLength(1)
        expect(ranges[0].start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    })

    test('ignores listed days on a layer whose time is switched off', () => {
        const ranges = resolve({
            enabled: false,
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(ranges).toEqual([
            { start: FALLBACK_START, end: FALLBACK_END },
        ])
    })

    test('spans the timeline window when the layer has no time config', () => {
        expect(resolve(undefined)).toEqual([
            { start: FALLBACK_START, end: FALLBACK_END },
        ])
    })

    test('reads an end time of "now" as the present moment', () => {
        const before = Date.now()
        const [range] = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: 'now',
        })

        expect(range.end.getTime()).toBeGreaterThanOrEqual(before)
    })

    test('still reads an extent written in a looser format than ISO 8601', () => {
        // Configs predating any format guidance carry values like this; the
        // extent has always been read leniently and stays that way.
        const [range] = resolve({
            enabled: true,
            dataStartTime: '2020-01-01 00:00:00',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(range.start.getTime()).toBe(
            new Date('2020-01-01 00:00:00').getTime()
        )
    })

    test('accepts a single listed day given as a bare string', () => {
        const ranges = resolve({
            enabled: true,
            dataDates: '2020-03-04' as unknown as string[],
        })

        expect(ranges.map((r) => r.label)).toEqual(['2020-03-04'])
    })
})
