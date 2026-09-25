import { act } from 'react'
import { vi } from 'vitest'
import { TRANSITION_DURATION_MS } from '../../lib/hooks/useWindowTransition'

/**
 * Motion under test.
 *
 * jsdom ships no `matchMedia`, so the reduced-motion preference reads as
 * unset, and jsdom does ship a real `requestAnimationFrame`, so a spec that
 * mounts the zoom state without stubbing the preference gets a zoom or fit
 * that runs on real frames, outside `act`. That fails as "the fit did
 * nothing" — the view sits where it was — rather than as anything naming
 * the cause. Every spec that reaches the zoom state stubs the preference one
 * way or the other, through here.
 */

/**
 * Reports the reduced-motion preference as `reduce`. Undone by
 * `vi.unstubAllGlobals()`, which the calling spec's `afterEach` owns.
 */
export const stubReducedMotion = (reduce: boolean): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
    }))
}

/** The fake clock's frame cadence, and the timestamp step frames report. */
export const FRAME = 16

/**
 * Puts `requestAnimationFrame` on the fake clock, so frames are stepped by
 * hand with `frames` and `settle`. Undone by `vi.useRealTimers()`, which
 * the calling spec's `afterEach` owns.
 */
export const fakeFrameClock = (): void => {
    vi.useFakeTimers({
        toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    })
}

/** Draws `n` frames, each inside its own `act`. */
export const frames = (n: number): void => {
    for (let i = 0; i < n; i++) act(() => vi.advanceTimersByTime(FRAME))
}

/** Runs the clock past the end of any transition in flight. */
export const settle = (): void => {
    act(() => vi.advanceTimersByTime(TRANSITION_DURATION_MS + 2 * FRAME))
}
