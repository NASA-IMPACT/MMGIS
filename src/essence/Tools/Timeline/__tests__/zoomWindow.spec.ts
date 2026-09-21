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
    interpolateWindow,
    minViewDuration,
    sliderToWindow,
    transformToWindow,
    windowAtSpan,
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

/**
 * Scaling a span is `windowAtSpan` with the span multiplied, so the floor and
 * the anchor's placement are covered there. What is `zoomAround`'s own is the
 * multiply, and the degenerate window the fraction divides by zero on.
 */
describe('zoomAround', () => {
    test('scales the span by the factor given, holding the anchor at its fraction', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-03T00:00:00Z') // 20% across
        const halved = zoomAround(held, 0.5, anchor, bounds, DAY)

        expect(span(halved)).toBe(5 * DAY)
        const fraction =
            (anchor.getTime() - halved.start.getTime()) / span(halved)
        expect(fraction).toBeCloseTo(0.2, 10)

        expect(span(zoomAround(held, 2, anchor, bounds, DAY))).toBe(20 * DAY)
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

describe('windowAtSpan', () => {
    test('holds the anchor at its fraction across any change of span', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-08T00:00:00Z') // 70% across
        for (const target of [4 * DAY, 10 * DAY, 25 * DAY]) {
            const result = windowAtSpan(held, target, anchor, bounds, DAY)
            expect(span(result)).toBe(target)
            const fraction =
                (anchor.getTime() - result.start.getTime()) / span(result)
            expect(fraction).toBeCloseTo(0.7, 10)
        }
    })

    test('settles the span on the floor before placing, so the floor never recentres', () => {
        // Asking for a day against a three-day floor places three days about
        // the anchor, not a day about the anchor widened about its own middle.
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-02T00:00:00Z') // 10% across
        const result = windowAtSpan(held, DAY, anchor, bounds, 3 * DAY)

        expect(span(result)).toBe(3 * DAY)
        expect(iso(result)).toEqual([
            '2019-01-01T16:48:00.000Z',
            '2019-01-04T16:48:00.000Z',
        ])
    })

    test('slides to a bound, and no further, when the held fraction runs past it', () => {
        // Ten days at the end of the mission, anchor a day in (10%). Doubling
        // while holding 10% would run nine days past the end; the window ends
        // at the bound and the anchor takes the smallest fraction reachable.
        const held = win('2021-12-22T00:00:00Z', '2022-01-01T00:00:00Z')
        const anchor = new Date('2021-12-23T00:00:00Z')
        const result = windowAtSpan(held, 20 * DAY, anchor, bounds, DAY)

        expect(span(result)).toBe(20 * DAY)
        expect(result.end.toISOString()).toBe(bounds.end.toISOString())
        expect(result.start.toISOString()).toBe('2021-12-12T00:00:00.000Z')
    })

    test('caps the span at the bounds and returns them', () => {
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const anchor = new Date('2019-01-02T00:00:00Z')
        const result = windowAtSpan(held, 100 * 365 * DAY, anchor, bounds, DAY)

        expect(iso(result)).toEqual(iso(bounds))
    })
})

describe('the logarithmic slider', () => {
    // The slider moves from the full window, with the scrubber at its centre.
    const anchor = new Date('2020-01-01T00:00:00Z')
    const minMs = 3 * DAY

    test('puts the full window at zero and the floor at one', () => {
        expect(span(sliderToWindow(0, bounds, anchor, bounds, minMs))).toBe(
            span(bounds)
        )
        expect(span(sliderToWindow(1, bounds, anchor, bounds, minMs))).toBe(minMs)
    })

    test('round-trips a position through a window and back', () => {
        // The span a position names does not depend on where the scrubber
        // is; only the placement does. The slider's own position, read back
        // from the view, has to agree with where it was dragged to — from a
        // window the scrubber sits off-centre in as much as a centred one.
        const offCentre = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const cases: [ViewWindow, Date][] = [
            [bounds, anchor],
            [offCentre, new Date('2019-01-02T00:00:00Z')],
        ]
        for (const [held, at] of cases) {
            for (const v of [0, 0.15, 0.4, 0.5, 0.73, 0.9, 1]) {
                const window = sliderToWindow(v, held, at, bounds, minMs)
                expect(windowToSlider(window, bounds, minMs)).toBeCloseTo(v, 4)
            }
        }
    })

    test('spends half its travel on the geometric midpoint of the range', () => {
        // Logarithmic, not linear: at v = 0.5 the span is the geometric mean of
        // the full window and the floor, not their average.
        const half = span(sliderToWindow(0.5, bounds, anchor, bounds, minMs))
        expect(half).toBeCloseTo(Math.sqrt(span(bounds) * minMs), -3)
    })

    test('holds the scrubber at its fractional position rather than centring on it', () => {
        // The scrubber sits a fifth of the way across; a slider move tightens
        // the view around that instant, which stays a fifth of the way across.
        const held = win('2019-01-01T00:00:00Z', '2019-01-11T00:00:00Z')
        const scrubber = new Date('2019-01-03T00:00:00Z')
        const result = sliderToWindow(0.5, held, scrubber, bounds, minMs)

        const fraction =
            (scrubber.getTime() - result.start.getTime()) / span(result)
        expect(fraction).toBeCloseTo(0.2, 6)
        expect(Math.abs(fraction - 0.5)).toBeGreaterThan(0.1)
    })

    test('slides only as far as a bound requires when the held fraction is unreachable', () => {
        // Ten days at the start of the mission, scrubber nine days in. Opening
        // to fifteen days while holding it at 90% would put the start four and
        // a half days before the mission; the window slides to the bound and
        // no further, and the scrubber keeps the largest fraction reachable.
        // Placing the span about the scrubber's centre would not have reached
        // the bound at all, and would have left the scrubber at 50%.
        const held = win('2018-01-01T00:00:00Z', '2018-01-11T00:00:00Z')
        const scrubber = new Date('2018-01-10T00:00:00Z')
        const fifteenDays = win('2018-01-01T00:00:00Z', '2018-01-16T00:00:00Z')
        const v = windowToSlider(fifteenDays, bounds, minMs)
        const result = sliderToWindow(v, held, scrubber, bounds, minMs)

        expect(result.start.toISOString()).toBe(bounds.start.toISOString())
        expect(Math.abs(span(result) - 15 * DAY)).toBeLessThanOrEqual(1)
        const fraction =
            (scrubber.getTime() - result.start.getTime()) / span(result)
        expect(fraction).toBeCloseTo(0.6, 6)
    })

    test('pins at zero when the bounds are no wider than the floor', () => {
        const narrow = win('2019-01-01T00:00:00Z', '2019-01-02T00:00:00Z')
        expect(windowToSlider(narrow, narrow, 3 * DAY)).toBe(0)
        expect(iso(sliderToWindow(0.5, narrow, anchor, narrow, 3 * DAY))).toEqual(
            iso(narrow)
        )

        // Bounds exactly as wide as the floor: the ratio is one, whose
        // logarithm is zero, so this is the case a division would blow up on.
        const exact = win('2019-01-01T00:00:00Z', '2019-01-04T00:00:00Z')
        expect(windowToSlider(exact, exact, 3 * DAY)).toBe(0)
        expect(iso(sliderToWindow(0.5, exact, anchor, exact, 3 * DAY))).toEqual(
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

describe('interpolateWindow', () => {
    const YEAR = 365 * DAY
    const CENTRE = new Date('2020-01-01T00:00:00Z').getTime()

    /** A window of `ms` about `centre`. */
    const about = (centre: number, ms: number): ViewWindow => ({
        start: new Date(centre - ms / 2),
        end: new Date(centre + ms / 2),
    })

    const centre = (w: ViewWindow) => (w.start.getTime() + w.end.getTime()) / 2

    const spansAlong = (at: (t: number) => ViewWindow, steps = 50) =>
        Array.from({ length: steps + 1 }, (_, k) => span(at(k / steps)))

    const isMonotonic = (values: number[], direction: 1 | -1) =>
        values.every((v, k) => k === 0 || Math.sign(v - values[k - 1]) !== -direction)

    test('returns the endpoints themselves at t = 0 and t = 1', () => {
        const from = about(CENTRE, YEAR)
        const to = about(CENTRE + 40 * DAY, 10 * DAY)
        const at = interpolateWindow(from, to)

        expect(at(0)).toBe(from)
        expect(at(1)).toBe(to)
        expect(at(-0.5)).toBe(from)
        expect(at(1.5)).toBe(to)
    })

    test('passes through the geometric mean of the spans on a zoom about a fixed centre', () => {
        const from = about(CENTRE, YEAR)
        const to = about(CENTRE, YEAR / 8)
        const mid = interpolateWindow(from, to)(0.5)

        const geometric = Math.sqrt(YEAR * (YEAR / 8))
        const arithmetic = (YEAR + YEAR / 8) / 2
        expect(Math.abs(span(mid) - geometric)).toBeLessThanOrEqual(1)
        expect(Math.abs(span(mid) - arithmetic)).toBeGreaterThan(DAY)
        expect(Math.abs(centre(mid) - CENTRE)).toBeLessThanOrEqual(1)
    })

    test('tightens monotonically on a zoom in about the scrubber, and opens monotonically on the way back', () => {
        // The scrubber sits off-centre, so the centre moves as the span
        // changes, as it does for every press of the buttons.
        const full = about(CENTRE, YEAR)
        const anchor = new Date(CENTRE + 100 * DAY)
        const tight = zoomAround(full, 0.5, anchor, bounds, 3 * DAY)

        expect(isMonotonic(spansAlong(interpolateWindow(full, tight)), -1)).toBe(true)
        expect(isMonotonic(spansAlong(interpolateWindow(tight, full)), 1)).toBe(true)
    })

    test('holds the anchor still on every frame of a zoom about it, not only at the ends', () => {
        // The pivot is what the press promised: the instant under the
        // scrubber does not move while the view tightens around it.
        const full = about(CENTRE, YEAR)
        const anchor = new Date(CENTRE + 140 * DAY)
        const held = anchor.getTime()
        const fractionAt = (w: ViewWindow) =>
            (held - w.start.getTime()) / span(w)

        for (const factor of [0.5, 2]) {
            const to = zoomAround(full, factor, anchor, bounds, 3 * DAY)
            const at = interpolateWindow(full, to, anchor)
            const start = fractionAt(full)

            for (let k = 0; k <= 50; k++) {
                expect(fractionAt(at(k / 50))).toBeCloseTo(start, 6)
            }
        }
    })

    test('carries the anchor across when a bound moves it, without overshooting', () => {
        // A zoom out at the edge of the mission cannot hold the anchor where
        // it was; the fraction travels to where it lands and stops there.
        const edge = win('2018-01-01T00:00:00Z', '2018-07-01T00:00:00Z')
        const anchor = new Date('2018-05-01T00:00:00Z')
        const held = anchor.getTime()
        const to = zoomAround(edge, 2, anchor, bounds, 3 * DAY)
        const at = interpolateWindow(edge, to, anchor)

        const fractions = Array.from({ length: 51 }, (_, k) => {
            const w = at(k / 50)
            return (held - w.start.getTime()) / span(w)
        })

        expect(isMonotonic(fractions, -1)).toBe(true)
        expect(fractions[0]).toBeCloseTo((held - edge.start.getTime()) / span(edge), 6)
        expect(fractions[50]).toBeCloseTo((held - to.start.getTime()) / span(to), 6)
    })

    test('reads a centre shift of a rounding millisecond as a pure zoom', () => {
        // Below PURE_ZOOM_SHIFT the shift is spent linearly and the path is
        // the geometric one, so the midpoint is the geometric mean of the
        // spans. Every zoom about a scrubber that sits dead centre lands here.
        const from = about(CENTRE, 1.5 * YEAR)
        const to = about(CENTRE + 1, 3 * YEAR)
        const at = interpolateWindow(from, to)

        const spans = spansAlong(at)
        expect(spans.every(Number.isFinite)).toBe(true)
        expect(isMonotonic(spans, 1)).toBe(true)
        expect(Math.abs(span(at(0.5)) - Math.sqrt(1.5 * YEAR * 3 * YEAR))).toBeLessThanOrEqual(1)
        expect(iso(at(1))).toEqual(iso(to))
    })

    test('stays finite where d3 interpolateZoom would return -Infinity', () => {
        // A shift just past PURE_ZOOM_SHIFT, across the widest ratio the
        // plugin reaches: a view at the hourly floor fitted out to a
        // four-year window. `b` lands near 3.5e8, well past where
        // log(sqrt(b² + 1) − b) cancels to log(0); -asinh(b) holds.
        const from = about(CENTRE, DAY)
        const to = about(CENTRE + 130 * 1000, 1460 * DAY)

        const w0 = DAY
        const w1 = 1460 * DAY
        const d = 130 * 1000
        const b0 = (w1 * w1 - w0 * w0 + 4 * d * d) / (2 * w0 * 2 * d)
        expect(b0).toBeGreaterThan(1e8)
        expect(Math.log(Math.sqrt(b0 * b0 + 1) - b0)).toBe(-Infinity)

        const spans = spansAlong(interpolateWindow(from, to))
        expect(spans.every(Number.isFinite)).toBe(true)
        expect(Math.max(...spans)).toBeGreaterThanOrEqual(1460 * DAY)
    })

    test('opens out to cross a long distance, and closes back in on arrival', () => {
        // Three days at one end of the mission to three days at the other.
        // Panning at three days wide would sweep years past in a blur; the
        // path zooms out to travel, so what crosses the chart is readable.
        const from = win('2018-01-02T00:00:00Z', '2018-01-05T00:00:00Z')
        const to = win('2021-12-20T00:00:00Z', '2021-12-23T00:00:00Z')
        const at = interpolateWindow(from, to)

        const spans = spansAlong(at)
        expect(Math.max(...spans)).toBeGreaterThan(YEAR)
        expect(span(at(0.5))).toBe(Math.max(...spans))
        expect(at(0.5).start.getTime()).toBeLessThan(centre(from))
        expect(at(0.5).end.getTime()).toBeGreaterThan(centre(to))
        expect(iso(at(1))).toEqual(iso(to))
    })

    test('interpolates a window without a span linearly', () => {
        // A degenerate global window collapses the view to an instant, and
        // an instant has no geometric path to anywhere.
        const from: ViewWindow = { start: new Date(CENTRE), end: new Date(CENTRE) }
        const to = win('2020-03-01T00:00:00Z', '2020-05-01T00:00:00Z')
        const mid = interpolateWindow(from, to)(0.5)

        expect(mid.start.getTime()).toBe((CENTRE + to.start.getTime()) / 2)
        expect(span(mid)).toBe(span(to) / 2)
    })
})
