import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The visible window, and the two loops it has to be kept out of.
 *
 * The process timezone is pinned behind UTC, so a signature quantising days
 * locally surfaces as a spurious refit here rather than passing on a UTC host
 * and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import {
    useTimelineZoom,
    type TimelineZoom,
    type UseTimelineZoomOptions,
} from '../lib/hooks/useTimelineZoom'
import type { LayerTimeData, TimeMode } from '../lib/types'
import {
    resolveLayerNavigation,
    type LayerNavigation,
} from '../lib/utils/layerNavigation'
import { windowToSlider, type ViewWindow } from '../lib/utils/zoomWindow'
import { fakeFrameClock, frames, settle, stubReducedMotion } from './support/motion'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const DAY = 86400000

const win = (start: string, end: string): ViewWindow => ({
    start: new Date(start),
    end: new Date(end),
})

const BOUNDS = win('2019-01-01T00:00:00Z', '2019-12-31T00:00:00Z')
const CURRENT = new Date('2019-07-01T00:00:00Z')

const nav = (over: Partial<LayerNavigation>): LayerNavigation => ({
    kind: 'periodic',
    start: BOUNDS.start,
    end: BOUNDS.end,
    hasOwnStart: false,
    hasOwnEnd: false,
    ...over,
})

const layer = (
    name: string,
    navigation?: LayerNavigation | null
): LayerTimeData => ({
    name,
    displayName: name,
    timeRanges: [{ start: BOUNDS.start, end: BOUNDS.end }],
    color: '#00b3c8',
    navigation,
})

const iso = (w: ViewWindow) => [w.start.toISOString(), w.end.toISOString()]

const span = (w: ViewWindow) => w.end.getTime() - w.start.getTime()

describe('useTimelineZoom', () => {
    let container: HTMLElement
    let root: Root
    let api: TimelineZoom
    let widened: ViewWindow[]

    const Harness: React.FC<{ options: UseTimelineZoomOptions }> = ({
        options,
    }) => {
        api = useTimelineZoom(options)
        return null
    }

    const defaults = (
        over: Partial<UseTimelineZoomOptions> = {}
    ): UseTimelineZoomOptions => ({
        bounds: BOUNDS,
        layers: [],
        currentTime: CURRENT,
        granularity: 'DAY' as TimeMode,
        onBoundsWiden: (start, end) => widened.push({ start, end }),
        ...over,
    })

    const render = (options: UseTimelineZoomOptions) => {
        act(() => {
            root.render(<Harness options={options} />)
        })
    }

    /** A layer whose own start predates the global window by seven months. */
    const reaching = () =>
        layer(
            'Sea Ice',
            nav({
                start: new Date('2018-06-01T00:00:00Z'),
                end: BOUNDS.end,
                hasOwnStart: true,
                hasOwnEnd: false,
            })
        )

    beforeEach(() => {
        // Reduced motion means a zoom or fit applies at once. Every
        // assertion outside 'in transition' reads the view straight after
        // an action, and relies on that.
        stubReducedMotion(true)
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        widened = []
        api = undefined as unknown as TimelineZoom
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
    })

    test('starts on the full global window', () => {
        render(defaults())

        expect(iso(api.view)).toEqual(iso(BOUNDS))
        expect(api.autoFit).toBe(true)
        expect(api.sliderValue).toBe(0)
    })

    test('halves the span on a zoom in, holding the current time in place', () => {
        render(defaults())

        act(() => api.zoomIn())

        expect(span(api.view)).toBe(span(BOUNDS) / 2)
        // The scrubber sat inside the view, so it keeps its fractional place.
        const before =
            (CURRENT.getTime() - BOUNDS.start.getTime()) / span(BOUNDS)
        const after =
            (CURRENT.getTime() - api.view.start.getTime()) / span(api.view)
        expect(after).toBeCloseTo(before, 6)
    })

    test('doubles the span on a zoom out, and stops at the global window', () => {
        render(defaults())

        act(() => api.zoomIn())
        act(() => api.zoomIn())
        expect(span(api.view)).toBe(span(BOUNDS) / 4)

        act(() => api.zoomOut())
        act(() => api.zoomOut())
        act(() => api.zoomOut())
        expect(iso(api.view)).toEqual(iso(BOUNDS))
    })

    test('applies two presses landing in one batch one after the other', () => {
        // A double-click on the button, or a caller zooming twice in one
        // handler, are one React batch. Each press has to act on the other's
        // result, not both on the view as it stood before either.
        render(defaults())

        act(() => {
            api.zoomIn()
            api.zoomIn()
        })

        expect(span(api.view)).toBe(span(BOUNDS) / 4)
    })

    test('anchors on the view centre when the scrubber sits outside it', () => {
        render(defaults({ currentTime: new Date('2019-01-02T00:00:00Z') }))

        act(() => api.setView(win('2019-06-01T00:00:00Z', '2019-08-01T00:00:00Z')))
        const centre =
            (api.view.start.getTime() + api.view.end.getTime()) / 2
        act(() => api.zoomIn())

        expect(
            (api.view.start.getTime() + api.view.end.getTime()) / 2
        ).toBeCloseTo(centre, 0)
    })

    test('never zooms in past the floor for the configured granularity', () => {
        render(defaults({ granularity: 'DAY' }))

        for (let i = 0; i < 20; i++) act(() => api.zoomIn())

        expect(span(api.view)).toBe(3 * DAY)
        expect(api.sliderValue).toBe(1)
    })

    test('unions only the bounds a layer named itself', () => {
        // The borrowed end is the global window's own edge. Read into the
        // union it would open the view out to the whole window and hide the
        // layer's real extent.
        render(
            defaults({
                layers: [
                    layer(
                        'Sea Ice',
                        nav({
                            start: new Date('2019-03-01T00:00:00Z'),
                            end: BOUNDS.end,
                            hasOwnStart: true,
                            hasOwnEnd: false,
                        })
                    ),
                ],
            })
        )

        // Fit to a single instant: widened to the floor about that instant.
        expect(span(api.view)).toBe(3 * DAY)
        expect(api.view.start.toISOString()).toBe('2019-02-27T12:00:00.000Z')
    })

    describe('widening to reach a layer', () => {
        test('widens once for a layer reaching outside the window, and settles on the refetch', () => {
            // Auto-fit widens to reach the layer's own start. The refetch that
            // follows completes the borrowed end to the new window edge, which
            // never entered the union, so there is nothing to widen to again.
            render(defaults({ layers: [reaching()] }))
            expect(widened).toHaveLength(1)

            const widerBounds = widened[0]
            expect(widerBounds.start.toISOString()).toBe(
                '2018-06-01T00:00:00.000Z'
            )

            const refetched = layer(
                'Sea Ice',
                nav({
                    start: new Date('2018-06-01T00:00:00Z'),
                    end: widerBounds.end,
                    hasOwnStart: true,
                    hasOwnEnd: false,
                })
            )
            render(defaults({ bounds: widerBounds, layers: [refetched] }))

            expect(widened).toHaveLength(1)
        })

        test('holds a widened fit across re-renders that echo the old window as a fresh object', () => {
            // Between the widen going out and core committing it, the parent
            // re-renders for unrelated reasons — a scrubber tick, say — with
            // the old window rebuilt as a new object of equal value. The fit
            // must not be snapped back inside that stale window.
            render(defaults({ layers: [reaching()] }))
            const fitted = iso(api.view)
            expect(api.view.start.getTime()).toBeLessThan(
                BOUNDS.start.getTime()
            )

            render(
                defaults({
                    bounds: { start: new Date(BOUNDS.start), end: new Date(BOUNDS.end) },
                    layers: [reaching()],
                    currentTime: new Date('2019-07-01T00:00:01Z'),
                })
            )

            expect(iso(api.view)).toEqual(fitted)
            expect(widened).toHaveLength(1)
        })

        test('holds a widened fit through a development-mode effect replay', () => {
            // StrictMode runs every effect twice on mount. The replay must
            // neither emit a second widen nor queue a clamp against the window
            // as it stood before the fit, which would land after the fit and
            // pull the view back inside the unwidened span.
            act(() => {
                root.render(
                    <React.StrictMode>
                        <Harness options={defaults({ layers: [reaching()] })} />
                    </React.StrictMode>
                )
            })

            expect(widened).toHaveLength(1)
            // The floor-span window about the layer's start, clamped inside
            // the widened span, which begins exactly at that start.
            expect(iso(api.view)).toEqual([
                '2018-06-01T00:00:00.000Z',
                '2018-06-04T00:00:00.000Z',
            ])
        })

        test('reads the slider against the widened span before core commits it', () => {
            // Until core echoes the widen, the prop still carries the old
            // window. The slider position has to describe the view within the
            // span the fit was made for, or it reports a position the view is
            // not at.
            const wide = layer(
                'Sea Ice',
                nav({
                    start: new Date('2018-06-01T00:00:00Z'),
                    end: new Date('2018-09-01T00:00:00Z'),
                    hasOwnStart: true,
                    hasOwnEnd: true,
                })
            )
            render(defaults({ layers: [wide] }))
            expect(widened).toHaveLength(1)

            const againstWidened = windowToSlider(api.view, widened[0], 3 * DAY)
            const againstStale = windowToSlider(api.view, BOUNDS, 3 * DAY)
            expect(againstWidened).not.toBeCloseTo(againstStale, 3)
            expect(api.sliderValue).toBeCloseTo(againstWidened, 10)
        })

        test('lets a later narrowing by core stand once it has committed the widen', () => {
            // The pending widen is only a bridge to core's commit. Once the
            // window covers it, a narrower window arriving afterwards is
            // core's decision, and the view is brought inside it rather than
            // held out in a span the hook once asked for.
            render(defaults({ layers: [reaching()] }))
            const committed = widened[0]
            render(defaults({ bounds: committed, layers: [reaching()] }))
            expect(api.view.start.getTime()).toBeLessThan(
                BOUNDS.start.getTime()
            )

            render(defaults({ bounds: BOUNDS, layers: [reaching()] }))

            expect(api.view.start.getTime()).toBeGreaterThanOrEqual(
                BOUNDS.start.getTime()
            )
            expect(api.view.end.getTime()).toBeLessThanOrEqual(
                BOUNDS.end.getTime()
            )
        })
    })

    describe('framing a sparse layer', () => {
        // Built the way the adapter builds it, so the stops land where
        // `resolveListedInstants` puts them: at each listed day's last instant.
        const sparse = (name: string, dates: string[]) =>
            layer(
                name,
                resolveLayerNavigation(
                    { enabled: true, dataDates: dates },
                    BOUNDS.start,
                    BOUNDS.end,
                    name
                )
            )

        test('opens the view to the first instant of the first listed day', () => {
            // The chart draws each listed day as a whole-day box from the
            // day's first instant, while the stop is its last. A view opening
            // at the stop meets the box's trailing edge and leaves the whole
            // first day off the left of the chart.
            const listed = sparse('MODIS', ['2019-03-05', '2019-03-12'])
            expect(listed.navigation?.start.toISOString()).toBe(
                '2019-03-05T23:59:59.999Z'
            )

            render(defaults({ layers: [layer('Basemap')] }))
            act(() => api.fitToLayer(listed))

            expect(api.view.start.getTime()).toBeLessThanOrEqual(
                new Date('2019-03-05T00:00:00Z').getTime()
            )
            expect(api.view.end.getTime()).toBeGreaterThanOrEqual(
                new Date('2019-03-12T23:59:59.999Z').getTime()
            )
        })

        test('widens to the first listed day, not to its last instant, and settles', () => {
            // Reaching a sparse layer outside the window widens the window.
            // Widened only to the stop, the window edge would sit at the end
            // of the first day's box and hide it at every zoom level, since
            // the view can never open past the window.
            const listed = sparse('MODIS', ['2018-11-05', '2018-11-20'])

            render(defaults({ layers: [listed] }))

            expect(widened).toHaveLength(1)
            expect(widened[0].start.toISOString()).toBe(
                '2018-11-05T00:00:00.000Z'
            )
            expect(api.view.start.getTime()).toBeLessThanOrEqual(
                new Date('2018-11-05T00:00:00Z').getTime()
            )

            // The revealed start is a fixed function of the layer's own list,
            // so the refetch the widen causes finds the same union and has
            // nothing further to widen to.
            const fitted = iso(api.view)
            render(defaults({ bounds: widened[0], layers: [listed] }))
            expect(widened).toHaveLength(1)
            expect(iso(api.view)).toEqual(fitted)
        })
    })

    describe("loop 2 — 'now' drift", () => {
        const openEnded = (end: string) =>
            layer(
                'GOES',
                nav({
                    start: new Date('2019-05-01T00:00:00Z'),
                    end: new Date(end),
                    hasOwnStart: true,
                    hasOwnEnd: true,
                })
            )

        test('does not refit when an open-ended layer re-resolves inside one displayed unit', () => {
            render(defaults({ layers: [openEnded('2019-07-01T09:00:00Z')] }))
            const fitted = iso(api.view)

            // The user zooms in by hand. Auto-fit stays armed.
            act(() => api.zoomIn())
            const held = iso(api.view)
            expect(held).not.toEqual(fitted)
            expect(api.autoFit).toBe(true)

            // Three refetches, each resolving 'now' to a later instant on the
            // same day. The signature quantises to the day, so none of them is
            // a change, and none takes the view back.
            for (const at of [
                '2019-07-01T09:00:07Z',
                '2019-07-01T14:22:00Z',
                '2019-07-01T23:59:59Z',
            ]) {
                render(defaults({ layers: [openEnded(at)] }))
                expect(iso(api.view)).toEqual(held)
            }
        })

        test('refits once the open end crosses into the next displayed unit', () => {
            render(defaults({ layers: [openEnded('2019-07-01T09:00:00Z')] }))
            act(() => api.zoomIn())
            const held = iso(api.view)

            render(defaults({ layers: [openEnded('2019-07-02T00:30:00Z')] }))

            expect(iso(api.view)).not.toEqual(held)
        })
    })

    test('refits when a layer appears, and leaves autoFit armed through a manual zoom', () => {
        const first = layer(
            'Sea Ice',
            nav({
                start: new Date('2019-03-01T00:00:00Z'),
                end: new Date('2019-04-01T00:00:00Z'),
                hasOwnStart: true,
                hasOwnEnd: true,
            })
        )
        const second = layer(
            'Sea Surface Temperature',
            nav({
                start: new Date('2019-08-01T00:00:00Z'),
                end: new Date('2019-09-01T00:00:00Z'),
                hasOwnStart: true,
                hasOwnEnd: true,
            })
        )

        render(defaults({ layers: [first] }))
        act(() => api.zoomIn())
        expect(api.autoFit).toBe(true)

        render(defaults({ layers: [first, second] }))

        // The union now spans both layers, padded by 4% of its own span.
        expect(api.view.start.getTime()).toBeLessThan(
            new Date('2019-03-01T00:00:00Z').getTime()
        )
        expect(api.view.end.getTime()).toBeGreaterThan(
            new Date('2019-09-01T00:00:00Z').getTime()
        )
    })

    describe('the auto-fit toggle', () => {
        const only = () =>
            layer(
                'Sea Ice',
                nav({
                    start: new Date('2019-03-01T00:00:00Z'),
                    end: new Date('2019-04-01T00:00:00Z'),
                    hasOwnStart: true,
                    hasOwnEnd: true,
                })
            )

        test('disarmed, leaves the view alone through a layer-set change', () => {
            render(defaults({ layers: [only()] }))
            const fitted = iso(api.view)

            act(() => api.toggleAutoFit())
            expect(api.autoFit).toBe(false)
            act(() => api.zoomOut())
            const manual = iso(api.view)
            expect(manual).not.toEqual(fitted)

            render(defaults({ layers: [only(), layer('Basemap')] }))

            expect(iso(api.view)).toEqual(manual)
        })

        test('refits on arming even when nothing has changed since the last fit', () => {
            // The layer set is the same one the view was last fitted to, so
            // the signature alone gives the refit no reason to run. Arming
            // itself has to be the reason.
            render(defaults({ layers: [only()] }))
            const fitted = iso(api.view)

            act(() => api.toggleAutoFit())
            act(() => api.zoomOut())
            expect(iso(api.view)).not.toEqual(fitted)

            act(() => api.toggleAutoFit())

            expect(api.autoFit).toBe(true)
            expect(iso(api.view)).toEqual(fitted)
        })
    })

    test('reports no fit available when no visible layer carries its own bounds', () => {
        render(defaults({ layers: [layer('Basemap'), layer('Hillshade', null)] }))

        expect(api.canFit).toBe(false)
        const held = iso(api.view)
        act(() => api.fitToLayers())
        expect(iso(api.view)).toEqual(held)
        expect(widened).toEqual([])
    })

    test('frames one layer on demand, widening the window to reach it', () => {
        const outside = layer(
            'Sea Ice',
            nav({
                start: new Date('2018-01-01T00:00:00Z'),
                end: new Date('2018-03-01T00:00:00Z'),
                hasOwnStart: true,
                hasOwnEnd: true,
            })
        )

        render(defaults({ layers: [layer('Basemap')] }))
        act(() => api.fitToLayer(outside))

        expect(widened).toHaveLength(1)
        expect(widened[0].start.toISOString()).toBe('2018-01-01T00:00:00.000Z')
    })

    test('ignores the runtime time mode entirely', () => {
        // The floor and the signature follow the configured granularity. The
        // runtime control is not an input to this hook at all, so there is
        // nothing for a mode press to change.
        render(defaults({ granularity: 'MONTH' }))
        for (let i = 0; i < 20; i++) act(() => api.zoomIn())
        const floored = iso(api.view)

        expect(span(api.view)).toBe(62 * DAY)

        // Re-render with every other input identical. A hook reading the mode
        // would have to take it as an option; this one has no such option, and
        // the view is unmoved.
        render(defaults({ granularity: 'MONTH' }))
        expect(iso(api.view)).toEqual(floored)
    })

    describe('in transition', () => {
        const within = (w: ViewWindow, of: ViewWindow) =>
            w.start.getTime() >= of.start.getTime() &&
            w.end.getTime() <= of.end.getTime()

        beforeEach(() => {
            stubReducedMotion(false)
            fakeFrameClock()
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        test('a zoom moves the view over frames and lands where an instant one would', () => {
            render(defaults())

            act(() => api.zoomIn())
            // Nothing has moved until a frame is drawn.
            expect(iso(api.view)).toEqual(iso(BOUNDS))

            const spans: number[] = []
            for (let i = 0; i < 8; i++) {
                frames(1)
                spans.push(span(api.view))
            }
            expect(spans.every((s, k) => k === 0 || s <= spans[k - 1])).toBe(true)
            expect(spans[spans.length - 1]).toBeLessThan(span(BOUNDS))
            expect(spans[spans.length - 1]).toBeGreaterThan(span(BOUNDS) / 2)

            settle()

            expect(span(api.view)).toBe(span(BOUNDS) / 2)
            const before =
                (CURRENT.getTime() - BOUNDS.start.getTime()) / span(BOUNDS)
            const after =
                (CURRENT.getTime() - api.view.start.getTime()) / span(api.view)
            expect(after).toBeCloseTo(before, 6)
        })

        test('the slider follows the view frame by frame', () => {
            render(defaults())
            act(() => api.zoomIn())
            frames(6)

            expect(api.sliderValue).toBeGreaterThan(0)
            expect(api.sliderValue).toBeLessThan(
                windowToSlider(
                    { start: BOUNDS.start, end: new Date(BOUNDS.start.getTime() + span(BOUNDS) / 2) },
                    BOUNDS,
                    3 * DAY
                )
            )
        })

        test('a wheel or drag landing mid-flight drops the transition and wins', () => {
            render(defaults())
            act(() => api.zoomIn())
            frames(6)

            const dragged = win('2019-03-01T00:00:00Z', '2019-05-01T00:00:00Z')
            act(() => api.setView(dragged))
            expect(iso(api.view)).toEqual(iso(dragged))

            settle()
            expect(iso(api.view)).toEqual(iso(dragged))
        })

        test('the slider landing mid-flight drops the transition and wins', () => {
            render(defaults())
            act(() => api.zoomIn())
            frames(6)

            act(() => api.setSliderValue(0.75))
            const slid = iso(api.view)
            expect(api.sliderValue).toBeCloseTo(0.75, 6)

            settle()
            expect(iso(api.view)).toEqual(slid)
        })

        test('a second press mid-flight restarts from the view as it stands and steps from the destination', () => {
            render(defaults())
            act(() => api.zoomIn())
            frames(6)
            const midway = iso(api.view)
            expect(midway).not.toEqual(iso(BOUNDS))

            act(() => api.zoomIn())
            // The first frame of the replacement is the view as it stood, so
            // nothing jumps back to where the first flight began.
            frames(1)
            expect(iso(api.view)).toEqual(midway)

            settle()
            expect(span(api.view)).toBe(span(BOUNDS) / 4)
        })

        test('two presses landing in one batch are two whole steps in one flight', () => {
            render(defaults())

            act(() => {
                api.zoomIn()
                api.zoomIn()
            })
            expect(iso(api.view)).toEqual(iso(BOUNDS))

            settle()
            expect(span(api.view)).toBe(span(BOUNDS) / 4)
        })

        test('a window narrowed by core mid-flight holds every later frame inside it', () => {
            render(defaults())
            act(() => api.zoomIn())
            frames(6)

            const narrower = win('2019-05-01T00:00:00Z', '2019-09-01T00:00:00Z')
            render(defaults({ bounds: narrower }))
            expect(within(api.view, narrower)).toBe(true)

            for (let i = 0; i < 8; i++) {
                frames(1)
                expect(within(api.view, narrower)).toBe(true)
            }

            settle()
            expect(within(api.view, narrower)).toBe(true)
            expect(span(api.view)).toBeLessThanOrEqual(span(narrower))
        })

        test('an auto-fit that widens flies to its fit while core commits the widen', () => {
            // The widen goes out with the fit, and the pending span is held
            // until core echoes it. Core's commit lands mid-flight: the render
            // that clears the pending widen must leave the view where the
            // flight has it, and the flight must reach the fit.
            render(defaults({ layers: [reaching()] }))
            expect(widened).toHaveLength(1)
            expect(iso(api.view)).toEqual(iso(BOUNDS))

            frames(6)
            const midway = iso(api.view)
            expect(midway).not.toEqual(iso(BOUNDS))

            render(defaults({ bounds: widened[0], layers: [reaching()] }))
            expect(iso(api.view)).toEqual(midway)
            expect(widened).toHaveLength(1)

            settle()
            expect(iso(api.view)).toEqual([
                '2018-06-01T00:00:00.000Z',
                '2018-06-04T00:00:00.000Z',
            ])
            expect(widened).toHaveLength(1)
        })

        test('a fit made on mount survives a development-mode effect replay', () => {
            act(() => {
                root.render(
                    <React.StrictMode>
                        <Harness options={defaults({ layers: [reaching()] })} />
                    </React.StrictMode>
                )
            })
            expect(widened).toHaveLength(1)

            settle()

            expect(iso(api.view)).toEqual([
                '2018-06-01T00:00:00.000Z',
                '2018-06-04T00:00:00.000Z',
            ])
        })

        test('a fit on demand animates too', () => {
            const outside = layer(
                'Sea Ice',
                nav({
                    start: new Date('2019-03-01T00:00:00Z'),
                    end: new Date('2019-04-01T00:00:00Z'),
                    hasOwnStart: true,
                    hasOwnEnd: true,
                })
            )
            render(defaults({ layers: [layer('Basemap')] }))

            act(() => api.fitToLayer(outside))
            expect(iso(api.view)).toEqual(iso(BOUNDS))

            settle()
            expect(api.view.start.getTime()).toBeLessThan(
                new Date('2019-03-01T00:00:00Z').getTime()
            )
            expect(api.view.end.getTime()).toBeGreaterThan(
                new Date('2019-04-01T00:00:00Z').getTime()
            )
            expect(span(api.view)).toBeLessThan(span(BOUNDS) / 4)
        })
    })
})
