import { describe, test, expect, vi } from 'vitest'

/**
 * The navigation model behind a layer row's first/previous/next/last controls:
 * where moving through a layer's data can land the timeline's current time.
 *
 * The process timezone is pinned behind UTC so that a resolver which snapped
 * days in local time would surface as a wrong day here, rather than passing on
 * a UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import { resolveLayerNavigation } from '../lib/utils/layerNavigation'
import type { LayerTimeConfig } from '../lib/utils/timeUtils'

const resolve = (time: unknown) =>
    resolveLayerNavigation(time as LayerTimeConfig | undefined)

const iso = (dates: Date[] | undefined) =>
    (dates ?? []).map((date) => date.toISOString())

describe('resolveLayerNavigation', () => {
    test('gives a layer with no time configuration nothing to navigate', () => {
        expect(resolve(undefined)).toBeNull()
    })

    test('gives a layer whose time is switched off nothing to navigate', () => {
        expect(
            resolve({
                enabled: false,
                dataStartTime: '2020-01-01T00:00:00Z',
                dataEndTime: '2020-12-31T00:00:00Z',
                dataDates: ['2020-03-04', '2020-07-19'],
            })
        ).toBeNull()
    })

    test('reads a layer that lists its days as sparse', () => {
        const nav = resolve({
            enabled: true,
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(nav?.kind).toBe('sparse')
    })

    test('stops on the last UTC instant of each listed day', () => {
        // The current time is the trailing edge of a layer's query window, so
        // a stop at the day's first instant would exclude the day's data.
        const nav = resolve({
            enabled: true,
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(iso(nav?.stops)).toEqual([
            '2020-03-04T23:59:59.999Z',
            '2020-07-19T23:59:59.999Z',
        ])
    })

    test('bounds a sparse layer by its first and last stop', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2019-01-01T00:00:00Z',
            dataEndTime: '2021-12-31T00:00:00Z',
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(nav?.start.toISOString()).toBe('2020-03-04T23:59:59.999Z')
        expect(nav?.end.toISOString()).toBe('2020-07-19T23:59:59.999Z')
    })

    test('orders the stops ascending however the days were listed', () => {
        const nav = resolve({
            enabled: true,
            dataDates: ['2020-07-19', '2020-01-02', '2020-03-04'],
        })

        expect(iso(nav?.stops)).toEqual([
            '2020-01-02T23:59:59.999Z',
            '2020-03-04T23:59:59.999Z',
            '2020-07-19T23:59:59.999Z',
        ])
    })

    test('gives a day listed more than once a single stop', () => {
        const nav = resolve({
            enabled: true,
            dataDates: [
                '2020-03-04',
                '2020-03-04T06:00:00Z',
                '2020-03-04T18:30:00Z',
                '2020-07-19',
            ],
        })

        expect(iso(nav?.stops)).toEqual([
            '2020-03-04T23:59:59.999Z',
            '2020-07-19T23:59:59.999Z',
        ])
    })

    test('drops unreadable days and keeps the readable ones', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2019-01-01T00:00:00Z',
            dataEndTime: '2021-12-31T00:00:00Z',
            dataDates: ['2020-03-04', 'not a date', '', '2020-07-19'],
        })

        expect(nav?.kind).toBe('sparse')
        expect(iso(nav?.stops)).toEqual([
            '2020-03-04T23:59:59.999Z',
            '2020-07-19T23:59:59.999Z',
        ])
    })

    test('reads days spaced out the way a comma-separated list leaves them', () => {
        const nav = resolve({
            enabled: true,
            dataDates: ['2020-03-04', ' 2020-07-19', '2020-11-02 '],
        })

        expect(iso(nav?.stops)).toEqual([
            '2020-03-04T23:59:59.999Z',
            '2020-07-19T23:59:59.999Z',
            '2020-11-02T23:59:59.999Z',
        ])
    })

    test('accepts a single listed day given as a bare string', () => {
        const nav = resolve({
            enabled: true,
            dataDates: '2020-03-04',
        })

        expect(nav?.kind).toBe('sparse')
        expect(iso(nav?.stops)).toEqual(['2020-03-04T23:59:59.999Z'])
    })

    test('reads a layer with an extent and no listed days as periodic', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
        expect(nav?.end.toISOString()).toBe('2020-12-31T00:00:00.000Z')
        expect(nav?.stops).toBeUndefined()
    })

    test('falls back to the extent when every listed day is unreadable', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
            dataDates: ['nonsense', ''],
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    })

    test('still reads an extent written in a looser format than ISO 8601', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01 00:00:00',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.start.getTime()).toBe(
            new Date('2020-01-01 00:00:00').getTime()
        )
    })

    test('reads an end time of "now" as the present moment', () => {
        const before = Date.now()
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: 'now',
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.end.getTime()).toBeGreaterThanOrEqual(before)
        expect(nav?.end.getTime()).toBeLessThanOrEqual(Date.now())
    })

    test('gives a layer with neither days nor an extent nothing to navigate', () => {
        expect(resolve({ enabled: true })).toBeNull()
    })

    test('gives a layer missing half its extent nothing to navigate', () => {
        expect(
            resolve({ enabled: true, dataStartTime: '2020-01-01T00:00:00Z' })
        ).toBeNull()
        expect(
            resolve({ enabled: true, dataEndTime: '2020-12-31T00:00:00Z' })
        ).toBeNull()
    })

    test('gives a layer with an unreadable extent nothing to navigate', () => {
        expect(
            resolve({
                enabled: true,
                dataStartTime: 'whenever',
                dataEndTime: 'whenever else',
            })
        ).toBeNull()
    })

    test('leaves the cadence unset until the layer config carries one', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.cadence).toBeUndefined()
    })
})
