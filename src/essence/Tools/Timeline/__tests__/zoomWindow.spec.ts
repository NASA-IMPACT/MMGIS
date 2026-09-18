import { describe, test, expect, vi } from 'vitest'

/**
 * The window arithmetic behind the zoom controls.
 *
 * The process timezone is pinned behind UTC, so arithmetic that leans on the
 * host's calendar surfaces as a wrong instant here rather than passing on a
 * UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import {
    clampWindow,
    describeSpan,
    fitWindow,
    minViewDuration,
    sliderToWindow,
    transformToWindow,
    windowToSlider,
    windowToTransform,
    zoomAround,
    type ViewWindow,
} from '../lib/utils/zoomWindow'

const HOUR = 3600000
const DAY = 24 * HOUR

const win = (start: string, end: string): ViewWindow => ({
    start: new Date(start),
    end: new Date(end),
})

/** A four-year mission window, wide enough that no floor binds inside it. */
const bounds = win('2018-01-01T00:00:00Z', '2022-01-01T00:00:00Z')

const iso = (w: ViewWindow) => [w.start.toISOString(), w.end.toISOString()]

const span = (w: ViewWindow) => w.end.getTime() - w.start.getTime()

describe('minViewDuration', () => {
    test('floors each granularity at enough ticks to read as an axis', () => {
        expect(minViewDuration('HOUR')).toBe(24 * HOUR)
        expect(minViewDuration('DAY')).toBe(3 * DAY)
        expect(minViewDuration('MONTH')).toBe(62 * DAY)
        expect(minViewDuration('YEAR')).toBe(730 * DAY)
    })
})

describe('clampWindow', () => {
    test('leaves a window that already fits untouched', () => {
        const held = win('2019-01-01T00:00:00Z', '2020-01-01T00:00:00Z')
        expect(iso(clampWindow(held, bounds, 3 * DAY))).toEqual(iso(held))
    })

    test('widens a below-floor window about its own centre', () => {
        // One hour wide, centred on noon, against a three-day floor.
        const held = win('2019-06-01T11:30:00Z', '2019-06-01T12:30:00Z')
        const result = clampWindow(held, bounds, 3 * DAY)

        expect(span(result)).toBe(3 * DAY)
        expect(iso(result)).toEqual([
            '2019-05-31T00:00:00.000Z',
            '2019-06-03T00:00:00.000Z',
        ])
    })

    test('slides a window that overhangs a bound back inside it', () => {
        const held = win('2021-12-01T00:00:00Z', '2022-03-01T00:00:00Z')
        const result = clampWindow(held, bounds, 3 * DAY)

        expect(span(result)).toBe(span(held))
        expect(result.end.toISOString()).toBe('2022-01-01T00:00:00.000Z')
    })

    test('widens before sliding, so a window at a bound still clears the floor', () => {
        // A one-minute window pinned at the bounds' start. Sliding first would
        // leave it a minute wide; widening first leaves it floor-wide and in
        // range.
        const held = win('2018-01-01T00:00:00Z', '2018-01-01T00:01:00Z')
        const result = clampWindow(held, bounds, 3 * DAY)

        expect(span(result)).toBe(3 * DAY)
        expect(iso(result)).toEqual([
            '2018-01-01T00:00:00.000Z',
            '2018-01-04T00:00:00.000Z',
        ])
    })

    test('caps the span at the bounds and returns them when the floor exceeds them', () => {
        const narrow = win('2019-01-01T00:00:00Z', '2019-01-02T00:00:00Z')
        const result = clampWindow(
            win('2019-01-01T06:00:00Z', '2019-01-01T07:00:00Z'),
            narrow,
            3 * DAY
        )

        expect(iso(result)).toEqual(iso(narrow))
    })

    test('survives a degenerate bounds with no span at all', () => {
        const point = win('2019-01-01T00:00:00Z', '2019-01-01T00:00:00Z')
        expect(iso(clampWindow(point, point, 3 * DAY))).toEqual(iso(point))
    })
})

describe('zoomAround', () => {
    test('holds the anchor at the same fractional position across a zoom', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-03T00:00:00Z') // 20% across
        const result = zoomAround(held, 0.5, anchor, bounds, DAY)

        expect(span(result)).toBe(5 * DAY)
        const fraction =
            (anchor.getTime() - result.start.getTime()) / span(result)
        expect(fraction).toBeCloseTo(0.2, 10)
    })

    test('widens by the factor given when zooming out', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-06T00:00:00Z')
        expect(span(zoomAround(held, 2, anchor, bounds, DAY))).toBe(20 * DAY)
    })

    test('never zooms in past the floor', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-05T00:00:00Z')
        const anchor = new Date('2019-01-03T00:00:00Z')
        expect(span(zoomAround(held, 0.1, anchor, bounds, 3 * DAY))).toBe(3 * DAY)
    })

    test('returns a zero-span window as it is rather than as Invalid Dates', () => {
        // The anchor's fractional position across a zero-span window is 0/0;
        // the fallback keeps that from turning both endpoints into NaN.
        const point = win('2019-01-01T00:00:00Z', '2019-01-01T00:00:00Z')
        expect(iso(zoomAround(point, 0.5, point.start, point, 3 * DAY))).toEqual(
            iso(point)
        )
    })
})

describe('the logarithmic slider', () => {
    const anchor = new Date('2020-01-01T00:00:00Z') // the bounds' centre
    const minMs = 3 * DAY

    test('puts the full window at zero and the floor at one', () => {
        expect(span(sliderToWindow(0, anchor, bounds, minMs))).toBe(span(bounds))
        expect(span(sliderToWindow(1, anchor, bounds, minMs))).toBe(minMs)
    })

    test('round-trips a position through a window and back', () => {
        for (const v of [0, 0.15, 0.4, 0.5, 0.73, 0.9, 1]) {
            const window = sliderToWindow(v, anchor, bounds, minMs)
            expect(windowToSlider(window, bounds, minMs)).toBeCloseTo(v, 4)
        }
    })

    test('spends half its travel on the geometric midpoint of the range', () => {
        // Logarithmic, not linear: at v = 0.5 the span is the geometric mean of
        // the full window and the floor, not their average.
        const half = span(sliderToWindow(0.5, anchor, bounds, minMs))
        expect(half).toBeCloseTo(Math.sqrt(span(bounds) * minMs), -3)
    })

    test('pins at zero when the bounds are no wider than the floor', () => {
        const narrow = win('2019-01-01T00:00:00Z', '2019-01-02T00:00:00Z')
        expect(windowToSlider(narrow, narrow, 3 * DAY)).toBe(0)
        expect(iso(sliderToWindow(0.5, anchor, narrow, 3 * DAY))).toEqual(
            iso(narrow)
        )

        // Bounds exactly as wide as the floor: the ratio is one, whose
        // logarithm is zero, so this is the case a division would blow up on.
        const exact = win('2019-01-01T00:00:00Z', '2019-01-04T00:00:00Z')
        expect(windowToSlider(exact, exact, 3 * DAY)).toBe(0)
        expect(iso(sliderToWindow(0.5, anchor, exact, 3 * DAY))).toEqual(
            iso(exact)
        )
    })
})

describe('fitWindow', () => {
    test('returns null when there is nothing to fit', () => {
        expect(fitWindow([], bounds, 3 * DAY, 0.04)).toBeNull()
    })

    test('pads the union of the extents on each side', () => {
        const result = fitWindow(
            [
                win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z'),
                win('2019-01-06T00:00:00Z', '2019-01-21T00:00:00Z'),
            ],
            bounds,
            3 * DAY,
            0.04
        )!

        // Union is 20 days; 4% of it is 0.8 days = 19h12m on each side.
        expect(iso(result)).toEqual([
            '2018-12-31T04:48:00.000Z',
            '2019-01-21T19:12:00.000Z',
        ])
    })

    test('frames a reversed extent forwards, padded by its own span', () => {
        // A layer configured with its start after its end arrives here
        // inverted. The union then runs backwards and the pad comes out
        // negative, and the result is the same forward window the extent
        // would have produced the right way round.
        const result = fitWindow(
            [win('2019-01-21T00:00:00Z', '2019-01-01T00:00:00Z')],
            bounds,
            3 * DAY,
            0.04
        )!

        expect(iso(result)).toEqual([
            '2018-12-31T04:48:00.000Z',
            '2019-01-21T19:12:00.000Z',
        ])
    })

    test('expands a below-floor fit to the floor around its centre', () => {
        const result = fitWindow(
            [win('2019-06-01T12:00:00Z', '2019-06-01T12:00:00Z')],
            bounds,
            3 * DAY,
            0.04
        )!

        expect(span(result)).toBe(3 * DAY)
        expect(iso(result)).toEqual([
            '2019-05-31T00:00:00.000Z',
            '2019-06-03T00:00:00.000Z',
        ])
    })
})

describe('the d3 transform conversions', () => {
    /**
     * Millisecond-exact equality here is load-bearing, not a nicety. The view
     * that consumes these conversions pushes its window into d3 as a
     * transform and reads d3's zoom events back as a window, and it tells
     * its own echo from a real user gesture by comparing the two windows for
     * equality. A single millisecond of drift in either direction would make
     * every echo look like a gesture, and the two would feed each other
     * forever. So the sweep covers the awkward cases — one-pixel and
     * odd-pixel widths, a view pinned on each bound of a twenty-year range,
     * a one-millisecond window, the full range, and endpoints on odd
     * milliseconds — and asserts exact ISO strings rather than closeness.
     */
    test('round-trip a window to the millisecond at every width', () => {
        const twentyYears = win('2005-01-01T00:00:00Z', '2025-01-01T00:00:00Z')
        const windows = [
            win('2005-01-01T00:00:00Z', '2005-01-02T00:00:00Z'),
            win('2024-12-31T00:00:00Z', '2025-01-01T00:00:00Z'),
            win('2015-06-15T12:00:00.000Z', '2015-06-15T12:00:00.001Z'),
            twentyYears,
            win('2019-03-07T13:41:07.123Z', '2019-08-22T04:02:59.999Z'),
        ]

        for (const width of [1, 7, 960, 3840]) {
            for (const held of windows) {
                const transform = windowToTransform(held, twentyYears, width)
                expect(
                    iso(transformToWindow(transform, twentyYears, width))
                ).toEqual(iso(held))
            }
        }
    })

    test('scale the full window to the identity transform', () => {
        const transform = windowToTransform(bounds, bounds, 960)

        expect(transform.k).toBe(1)
        expect(transform.x).toBe(0)
    })

    test('fall back to the identity transform with no width to scale into', () => {
        expect(windowToTransform(bounds, bounds, 0).k).toBe(1)
    })
})

describe('describeSpan', () => {
    test('renders a duration in the coarsest unit that fits', () => {
        expect(describeSpan(14 * DAY)).toBe('14 days')
        expect(describeSpan(DAY)).toBe('1 day')
        expect(describeSpan(6 * HOUR)).toBe('6 hours')
        expect(describeSpan(400 * DAY)).toBe('1 year')
        expect(describeSpan(90 * DAY)).toBe('3 months')
    })
})
