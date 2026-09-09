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

import {
    navigateLayer,
    resolveLayerNavigation,
} from '../lib/utils/layerNavigation'
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import type { LayerTimeConfig } from '../lib/utils/timeUtils'
import type { TimeMode } from '../lib/types'

/** The timeline's own window, standing in for a bound a layer leaves unset. */
const windowStart = new Date('2018-01-01T00:00:00Z')
const windowEnd = new Date('2022-01-01T00:00:00Z')

const resolve = (
    time: unknown,
    fallbackStart = windowStart,
    fallbackEnd = windowEnd
) =>
    resolveLayerNavigation(
        time as LayerTimeConfig | undefined,
        fallbackStart,
        fallbackEnd
    )

const iso = (dates: Date[] | undefined) =>
    (dates ?? []).map((date) => date.toISOString())

/** A sparse model whose stops close the listed days, as the resolver builds. */
const sparseNav = (...days: string[]): LayerNavigation => {
    const stops = days.map((day) => new Date(`${day}T23:59:59.999Z`))
    return {
        kind: 'sparse',
        stops,
        start: stops[0],
        end: stops[stops.length - 1],
    }
}

const periodicNav = (start: string, end: string): LayerNavigation => ({
    kind: 'periodic',
    start: new Date(start),
    end: new Date(end),
})

const goTo = (
    nav: LayerNavigation,
    from: string,
    action: 'first' | 'prev' | 'next' | 'last',
    mode: TimeMode = 'DAY'
) => navigateLayer(nav, new Date(from), action, mode)?.toISOString() ?? null

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

    test('completes a missing end from the timeline window', () => {
        // The half the layer leaves unset is the half the timeline draws its
        // bar over, so the controls cover the span the row shows.
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
        expect(nav?.end.toISOString()).toBe('2022-01-01T00:00:00.000Z')
    })

    test('completes a missing start from the timeline window', () => {
        const nav = resolve({
            enabled: true,
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.start.toISOString()).toBe('2018-01-01T00:00:00.000Z')
        expect(nav?.end.toISOString()).toBe('2020-12-31T00:00:00.000Z')
    })

    test('completes an unreadable bound from the timeline window', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: 'whenever',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.kind).toBe('periodic')
        expect(nav?.start.toISOString()).toBe('2018-01-01T00:00:00.000Z')
        expect(nav?.end.toISOString()).toBe('2020-12-31T00:00:00.000Z')
    })

    test('leaves a fully configured extent alone', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
        })

        expect(nav?.start.toISOString()).toBe('2020-01-01T00:00:00.000Z')
        expect(nav?.end.toISOString()).toBe('2020-12-31T00:00:00.000Z')
    })

    test('leaves a layer listing its days bounded by its stops', () => {
        // Listed days say where the layer holds data outright, so the window
        // has nothing to fill in.
        const nav = resolve({
            enabled: true,
            dataDates: ['2020-03-04', '2020-07-19'],
        })

        expect(nav?.start.toISOString()).toBe('2020-03-04T23:59:59.999Z')
        expect(nav?.end.toISOString()).toBe('2020-07-19T23:59:59.999Z')
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
})

describe('navigateLayer over a sparse layer', () => {
    const nav = sparseNav(
        '2020-01-02',
        '2020-03-04',
        '2020-07-19',
        '2020-11-02'
    )
    const single = sparseNav('2020-03-04')

    test('moves to the stop that follows the current time', () => {
        expect(goTo(nav, '2020-05-01T00:00:00Z', 'next')).toBe(
            '2020-07-19T23:59:59.999Z'
        )
    })

    test('moves to the stop that precedes the current time', () => {
        expect(goTo(nav, '2020-05-01T00:00:00Z', 'prev')).toBe(
            '2020-03-04T23:59:59.999Z'
        )
    })

    test('reaches into the layer from before every stop', () => {
        expect(goTo(nav, '2019-06-15T00:00:00Z', 'next')).toBe(
            '2020-01-02T23:59:59.999Z'
        )
    })

    test('reaches back into the layer from months past its last stop', () => {
        // One press, however far the current time sits from the data.
        expect(goTo(nav, '2021-06-15T00:00:00Z', 'prev')).toBe(
            '2020-11-02T23:59:59.999Z'
        )
    })

    test('moves off a stop the current time already sits on', () => {
        expect(goTo(nav, '2020-03-04T23:59:59.999Z', 'next')).toBe(
            '2020-07-19T23:59:59.999Z'
        )
        expect(goTo(nav, '2020-03-04T23:59:59.999Z', 'prev')).toBe(
            '2020-01-02T23:59:59.999Z'
        )
    })

    test('has nowhere to go beyond either end', () => {
        expect(goTo(nav, '2020-11-02T23:59:59.999Z', 'next')).toBeNull()
        expect(goTo(nav, '2021-06-15T00:00:00Z', 'next')).toBeNull()
        expect(goTo(nav, '2020-01-02T23:59:59.999Z', 'prev')).toBeNull()
        expect(goTo(nav, '2019-06-15T00:00:00Z', 'prev')).toBeNull()
    })

    test('jumps to the outermost stops whatever the current time', () => {
        expect(goTo(nav, '2020-05-01T00:00:00Z', 'first')).toBe(
            '2020-01-02T23:59:59.999Z'
        )
        expect(goTo(nav, '2020-05-01T00:00:00Z', 'last')).toBe(
            '2020-11-02T23:59:59.999Z'
        )
        expect(goTo(nav, '2025-01-01T00:00:00Z', 'first')).toBe(
            '2020-01-02T23:59:59.999Z'
        )
    })

    test('bounds a layer holding a single day by that one stop', () => {
        expect(goTo(single, '2020-05-01T00:00:00Z', 'first')).toBe(
            '2020-03-04T23:59:59.999Z'
        )
        expect(goTo(single, '2020-05-01T00:00:00Z', 'last')).toBe(
            '2020-03-04T23:59:59.999Z'
        )
        expect(goTo(single, '2020-01-01T00:00:00Z', 'next')).toBe(
            '2020-03-04T23:59:59.999Z'
        )
        expect(goTo(single, '2020-03-04T23:59:59.999Z', 'next')).toBeNull()
        expect(goTo(single, '2020-05-01T00:00:00Z', 'prev')).toBe(
            '2020-03-04T23:59:59.999Z'
        )
        expect(goTo(single, '2020-03-04T23:59:59.999Z', 'prev')).toBeNull()
    })

    test('lands on stops rather than stepping by the timeline granularity', () => {
        // The gaps between stops are the layer's, not the axis unit's, so the
        // same press lands in the same place at every mode.
        const modes: TimeMode[] = ['YEAR', 'MONTH', 'DAY', 'HOUR']
        for (const mode of modes) {
            expect(goTo(nav, '2020-05-01T00:00:00Z', 'next', mode)).toBe(
                '2020-07-19T23:59:59.999Z'
            )
            expect(goTo(nav, '2020-05-01T00:00:00Z', 'prev', mode)).toBe(
                '2020-03-04T23:59:59.999Z'
            )
        }
    })
})

describe('navigateLayer over a periodic layer', () => {
    const nav = periodicNav('2020-01-01T00:00:00Z', '2020-12-31T00:00:00Z')

    test('reaches the near edge of the extent from outside it', () => {
        expect(goTo(nav, '2019-06-15T00:00:00Z', 'next')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2021-06-15T00:00:00Z', 'prev')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
    })

    test('has nowhere to go beyond either edge', () => {
        expect(goTo(nav, '2020-12-31T00:00:00Z', 'next')).toBeNull()
        expect(goTo(nav, '2021-06-15T00:00:00Z', 'next')).toBeNull()
        expect(goTo(nav, '2020-01-01T00:00:00Z', 'prev')).toBeNull()
        expect(goTo(nav, '2019-06-15T00:00:00Z', 'prev')).toBeNull()
    })

    test('steps by the timeline granularity inside the extent', () => {
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'next', 'HOUR')).toBe(
            '2020-05-15T13:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'next', 'DAY')).toBe(
            '2020-05-16T12:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'next', 'MONTH')).toBe(
            '2020-06-15T12:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'prev', 'HOUR')).toBe(
            '2020-05-15T11:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'prev', 'DAY')).toBe(
            '2020-05-14T12:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T12:00:00Z', 'prev', 'MONTH')).toBe(
            '2020-04-15T12:00:00.000Z'
        )
    })

    test('steps in UTC across a local daylight-saving boundary', () => {
        // The process runs behind UTC, where a local day either side of the
        // spring change is 23 hours long; stepping locally would drift the
        // clock this lands on.
        expect(goTo(nav, '2020-03-07T12:00:00Z', 'next', 'DAY')).toBe(
            '2020-03-08T12:00:00.000Z'
        )
        expect(goTo(nav, '2020-03-09T12:00:00Z', 'prev', 'DAY')).toBe(
            '2020-03-08T12:00:00.000Z'
        )
    })

    test('clamps a step that would overshoot the extent', () => {
        expect(goTo(nav, '2020-12-15T00:00:00Z', 'next', 'MONTH')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'next', 'YEAR')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
        expect(goTo(nav, '2020-01-15T00:00:00Z', 'prev', 'MONTH')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'prev', 'YEAR')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
    })

    test('jumps to the edges of the extent whatever the current time', () => {
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'first')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'last')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
        expect(goTo(nav, '2025-01-01T00:00:00Z', 'first')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2015-01-01T00:00:00Z', 'last')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
    })
})

describe('navigateLayer over a half-configured layer', () => {
    test('navigates a layer with only a start across the timeline window', () => {
        const nav = resolve({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
        }) as LayerNavigation

        expect(goTo(nav, '2019-06-15T00:00:00Z', 'next')).toBe(
            '2020-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2019-06-15T00:00:00Z', 'prev')).toBeNull()
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'last')).toBe(
            '2022-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2022-01-01T00:00:00Z', 'next')).toBeNull()
    })

    test('navigates a layer with only an end across the timeline window', () => {
        const nav = resolve({
            enabled: true,
            dataEndTime: '2020-12-31T00:00:00Z',
        }) as LayerNavigation

        expect(goTo(nav, '2021-06-15T00:00:00Z', 'prev')).toBe(
            '2020-12-31T00:00:00.000Z'
        )
        expect(goTo(nav, '2021-06-15T00:00:00Z', 'next')).toBeNull()
        expect(goTo(nav, '2020-05-15T00:00:00Z', 'first')).toBe(
            '2018-01-01T00:00:00.000Z'
        )
        expect(goTo(nav, '2018-01-01T00:00:00Z', 'prev')).toBeNull()
    })
})
