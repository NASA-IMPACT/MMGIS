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
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import type { ViewWindow } from '../lib/utils/zoomWindow'

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

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        widened = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
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
        // The borrowed end must not reach the union, or it would drag the view
        // out to the global window and hide the layer's real extent.
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

    describe('loop 1 — fallback-completed bounds', () => {
        test('emits exactly one widen for a layer reaching outside the window, and settles', () => {
            // A layer whose own start predates the global window. Auto-fit
            // widens to reach it; the refetch that follows must not produce a
            // second, wider union off the back of the first.
            const reaching = layer(
                'Sea Ice',
                nav({
                    start: new Date('2018-06-01T00:00:00Z'),
                    end: BOUNDS.end,
                    hasOwnStart: true,
                    hasOwnEnd: false,
                })
            )

            render(defaults({ layers: [reaching] }))
            expect(widened).toHaveLength(1)

            const widerBounds = widened[0]
            expect(widerBounds.start.toISOString()).toBe(
                '2018-06-01T00:00:00.000Z'
            )

            // The widen re-runs the layer fetch. The borrowed end follows the
            // new, wider global end — and must change nothing, because it
            // never entered the union.
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
            const reaching = layer(
                'Sea Ice',
                nav({
                    start: new Date('2018-06-01T00:00:00Z'),
                    end: BOUNDS.end,
                    hasOwnStart: true,
                    hasOwnEnd: false,
                })
            )

            render(defaults({ layers: [reaching] }))
            const fitted = iso(api.view)
            expect(api.view.start.getTime()).toBeLessThan(
                BOUNDS.start.getTime()
            )

            render(
                defaults({
                    bounds: { start: new Date(BOUNDS.start), end: new Date(BOUNDS.end) },
                    layers: [reaching],
                    currentTime: new Date('2019-07-01T00:00:01Z'),
                })
            )

            expect(iso(api.view)).toEqual(fitted)
            expect(widened).toHaveLength(1)
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

    test('refits on arming and leaves the view alone on disarming', () => {
        const only = layer(
            'Sea Ice',
            nav({
                start: new Date('2019-03-01T00:00:00Z'),
                end: new Date('2019-04-01T00:00:00Z'),
                hasOwnStart: true,
                hasOwnEnd: true,
            })
        )
        render(defaults({ layers: [only] }))
        const fitted = iso(api.view)

        act(() => api.toggleAutoFit())
        expect(api.autoFit).toBe(false)
        act(() => api.zoomOut())
        const manual = iso(api.view)
        expect(manual).not.toEqual(fitted)

        // Disarmed: a layer-set change no longer moves the view.
        render(defaults({ layers: [only, layer('Basemap')] }))
        expect(iso(api.view)).toEqual(manual)

        // Arming refits at once, with the signature unchanged since the last fit.
        act(() => api.toggleAutoFit())
        expect(api.autoFit).toBe(true)
        expect(iso(api.view)).toEqual(fitted)
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
})
