import { useCallback, useEffect, useMemo, useRef } from 'react'
import { prefersReducedMotion } from '../utils/reducedMotion'
import { interpolateWindow, sameWindow, type ViewWindow } from '../utils/zoomWindow'

/**
 * How long a transition takes, whatever its distance. A duration derived from
 * the path's length reads well for a map but not for a zoom button: a
 * hundredfold fit would take seconds, and a run of presses would each take a
 * different time.
 */
export const TRANSITION_DURATION_MS = 300

/** Progress eased so a transition starts and settles gently. */
const easeCubicInOut = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export interface WindowTransition {
    /**
     * Moves the view from `from` to `to`, delivering a window per frame and
     * `to` itself on the last. Delivered at once, in one call, when the
     * viewer prefers reduced motion, when frames cannot be scheduled, or when
     * there is no distance to cover. A transition already in flight is
     * dropped where it stands.
     */
    animateTo(from: ViewWindow, to: ViewWindow): void
    /** Drops a transition in flight where it stands. Nothing more is delivered. */
    cancel(): void
    /** Where a transition in flight is heading, or null when none is. */
    target(): ViewWindow | null
}

interface Flight {
    to: ViewWindow
    at: (t: number) => ViewWindow
    /** The timestamp of the first frame, from which progress is measured. */
    startedAt: number | null
    /** The pending frame request, or null while none is queued. */
    frame: number | null
}

const canSchedule = (): boolean =>
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'

/**
 * Drives a window from one value to another over `requestAnimationFrame`,
 * handing each frame's window to `onFrame`. The caller owns the state; this
 * only paces the change to it.
 *
 * A flight is kept across a development-mode effect replay. The replay's
 * teardown cancels the queued frame, as an unmount does, and its re-run finds
 * the flight standing and queues the frame again; a teardown that is really
 * an unmount has no re-run, so nothing is delivered after it.
 */
export function useWindowTransition(
    onFrame: (win: ViewWindow) => void
): WindowTransition {
    const onFrameRef = useRef(onFrame)
    useEffect(() => {
        onFrameRef.current = onFrame
    }, [onFrame])

    const flightRef = useRef<Flight | null>(null)

    const step = useCallback((timestamp: number) => {
        const flight = flightRef.current
        if (!flight) return
        flight.frame = null
        if (flight.startedAt === null) flight.startedAt = timestamp

        const progress = (timestamp - flight.startedAt) / TRANSITION_DURATION_MS
        if (progress >= 1) {
            flightRef.current = null
            onFrameRef.current(flight.to)
            return
        }

        // The next frame is queued before this one is delivered, so a
        // cancel made in response to the delivery finds a request to cancel.
        flight.frame = requestAnimationFrame(step)
        onFrameRef.current(flight.at(easeCubicInOut(Math.max(0, progress))))
    }, [])

    const cancel = useCallback(() => {
        const flight = flightRef.current
        if (!flight) return
        if (flight.frame !== null) cancelAnimationFrame(flight.frame)
        flightRef.current = null
    }, [])

    const animateTo = useCallback(
        (from: ViewWindow, to: ViewWindow) => {
            cancel()

            if (sameWindow(from, to) || prefersReducedMotion() || !canSchedule()) {
                onFrameRef.current(to)
                return
            }

            const flight: Flight = {
                to,
                at: interpolateWindow(from, to),
                startedAt: null,
                frame: null,
            }
            flightRef.current = flight
            flight.frame = requestAnimationFrame(step)
        },
        [cancel, step]
    )

    const target = useCallback(() => flightRef.current?.to ?? null, [])

    useEffect(() => {
        const standing = flightRef.current
        if (standing && standing.frame === null && canSchedule()) {
            standing.frame = requestAnimationFrame(step)
        }
        return () => {
            const flight = flightRef.current
            if (flight && flight.frame !== null) {
                cancelAnimationFrame(flight.frame)
                flight.frame = null
            }
        }
    }, [step])

    return useMemo(
        () => ({ animateTo, cancel, target }),
        [animateTo, cancel, target]
    )
}
