import React, { act, useEffect, useRef } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import {
    useWindowTransition,
    TRANSITION_DURATION_MS,
    type WindowTransition,
} from '../lib/hooks/useWindowTransition'
import type { ViewWindow } from '../lib/utils/zoomWindow'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const DAY = 86400000
const FRAME = 16

const win = (start: string, end: string): ViewWindow => ({
    start: new Date(start),
    end: new Date(end),
})

const iso = (w: ViewWindow) => [w.start.toISOString(), w.end.toISOString()]

const span = (w: ViewWindow) => w.end.getTime() - w.start.getTime()

const FULL = win('2019-01-01T00:00:00Z', '2020-01-01T00:00:00Z')
const TIGHT = win('2019-06-01T00:00:00Z', '2019-07-01T00:00:00Z')
const OTHER = win('2019-03-01T00:00:00Z', '2019-04-01T00:00:00Z')

/**
 * The frame driver behind every animated zoom. Frames are stepped by hand on
 * a faked `requestAnimationFrame`, whose timestamps are the fake clock.
 */
describe('useWindowTransition', () => {
    let container: HTMLElement
    let root: Root
    let api: WindowTransition
    let delivered: ViewWindow[]

    const stubMotion = (reduce: boolean) =>
        vi.stubGlobal('matchMedia', (query: string) => ({
            matches: reduce && query === '(prefers-reduced-motion: reduce)',
        }))

    const Harness: React.FC = () => {
        api = useWindowTransition((w) => delivered.push(w))
        return null
    }

    const mount = (element: React.ReactElement = <Harness />) => {
        act(() => {
            root.render(element)
        })
    }

    const frames = (n: number) => {
        for (let i = 0; i < n; i++) act(() => vi.advanceTimersByTime(FRAME))
    }

    const settle = () => act(() => vi.advanceTimersByTime(TRANSITION_DURATION_MS + 2 * FRAME))

    beforeEach(() => {
        stubMotion(false)
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        delivered = []
        api = undefined as unknown as WindowTransition
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    test('delivers a window per frame and the target itself on the last', () => {
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        expect(delivered).toHaveLength(0)

        settle()

        // The first frame is the start itself; every one after tightens.
        expect(iso(delivered[0])).toEqual(iso(FULL))
        const spans = delivered.map(span)
        expect(spans.every((s, k) => k === 0 || s < spans[k - 1])).toBe(true)
        expect(delivered[delivered.length - 1]).toBe(TIGHT)
        // ~300ms of 16ms frames, plus the opening one.
        expect(delivered.length).toBeGreaterThanOrEqual(18)
        expect(delivered.length).toBeLessThanOrEqual(21)

        // Nothing follows the target.
        const count = delivered.length
        frames(5)
        expect(delivered).toHaveLength(count)
        expect(api.target()).toBeNull()
    })

    test('names the destination while in flight', () => {
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        expect(api.target()).toBe(TIGHT)
        frames(3)
        expect(api.target()).toBe(TIGHT)
    })

    test('applies the target at once under reduced motion', () => {
        stubMotion(true)
        mount()
        act(() => api.animateTo(FULL, TIGHT))

        expect(delivered).toEqual([TIGHT])
        expect(api.target()).toBeNull()
        settle()
        expect(delivered).toEqual([TIGHT])
    })

    test('applies the target at once when frames cannot be scheduled', () => {
        vi.stubGlobal('requestAnimationFrame', undefined)
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        expect(delivered).toEqual([TIGHT])
    })

    test('applies the target at once when there is no distance to cover', () => {
        mount()
        act(() => api.animateTo(FULL, { start: new Date(FULL.start), end: new Date(FULL.end) }))
        expect(delivered).toHaveLength(1)
        expect(iso(delivered[0])).toEqual(iso(FULL))
        expect(api.target()).toBeNull()
    })

    test('cancel drops the flight where it stands', () => {
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        frames(4)
        const count = delivered.length
        expect(count).toBeGreaterThan(1)

        act(() => api.cancel())

        expect(api.target()).toBeNull()
        settle()
        expect(delivered).toHaveLength(count)
        expect(iso(delivered[count - 1])).not.toEqual(iso(TIGHT))
    })

    test('a later flight replaces the one in progress', () => {
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        frames(4)
        const midway = delivered[delivered.length - 1]

        act(() => api.animateTo(midway, OTHER))
        expect(api.target()).toBe(OTHER)
        frames(1)
        // The replacement opens on the window it was given, not on a frame
        // of the flight it replaced.
        expect(delivered[delivered.length - 1]).toBe(midway)

        settle()
        expect(delivered[delivered.length - 1]).toBe(OTHER)
        expect(delivered).not.toContain(TIGHT)
    })

    test('unmounting mid-flight cancels the queued frame and delivers nothing after', () => {
        const cancelled = vi.spyOn(globalThis, 'cancelAnimationFrame')
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        frames(3)
        const count = delivered.length

        act(() => root.unmount())

        expect(cancelled).toHaveBeenCalled()
        settle()
        expect(delivered).toHaveLength(count)
    })

    test('a development-mode effect replay leaves the flight running', () => {
        // StrictMode tears every effect down and re-runs it on mount. A
        // flight begun by an effect is torn down with the frame queue and
        // has to be put back on it, or a fit made on mount would stop dead.
        const Starter: React.FC = () => {
            const transition = useWindowTransition((w) => delivered.push(w))
            const started = useRef(false)
            useEffect(() => {
                if (started.current) return
                started.current = true
                transition.animateTo(FULL, TIGHT)
            }, [transition])
            return null
        }

        mount(
            <React.StrictMode>
                <Starter />
            </React.StrictMode>
        )
        settle()

        expect(delivered.length).toBeGreaterThan(1)
        expect(delivered[delivered.length - 1]).toBe(TIGHT)
    })

    test('paces frames by the frame timestamp, easing in and out', () => {
        mount()
        act(() => api.animateTo(FULL, TIGHT))
        settle()

        // Eased: the change over the opening frames is smaller than the
        // change over the middle ones, in log-span terms.
        const logs = delivered.map((w) => Math.log(span(w)))
        const opening = Math.abs(logs[2] - logs[1])
        const middle = Math.abs(logs[10] - logs[9])
        expect(opening).toBeLessThan(middle)
        expect(delivered.some((w) => span(w) < span(FULL) && span(w) > span(TIGHT))).toBe(true)
        expect(delivered.some((w) => span(w) < 3 * DAY)).toBe(false)
    })
})
