import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import moment from 'moment'
import type { LayerTimeData, TimeMode } from '../types'
import { revealStart, type LayerNavigation } from '../utils/layerNavigation'
import {
    clampWindow,
    fitWindow,
    minViewDuration,
    revealWindow,
    sameWindow,
    sliderToWindow,
    windowToSlider,
    zoomAround,
    type ViewWindow,
} from '../utils/zoomWindow'
import { useWindowTransition } from './useWindowTransition'

/** How much of the union's span a fit leaves clear at each edge. */
const PAD_FRACTION = 0.04

/** The `±` buttons' scaling factors. */
const ZOOM_IN_FACTOR = 0.5
const ZOOM_OUT_FACTOR = 2

/** The quantisation unit a signature floors each bound to, by granularity. */
const SIGNATURE_UNIT: Record<TimeMode, moment.unitOfTime.StartOf> = {
    HOUR: 'hour',
    DAY: 'day',
    MONTH: 'month',
    YEAR: 'year',
}

export interface UseTimelineZoomOptions {
    /** The global window: mission time state, shared with core. */
    bounds: ViewWindow
    layers: LayerTimeData[]
    /** Where the scrubber sits — the anchor the buttons and slider zoom about. */
    currentTime: Date
    /**
     * The dashboard's display granularity, read once from config at load. Not
     * the runtime `timeMode` control: that is playback-and-navigation only, and
     * a floor that moved when a playback button was pressed would permit a
     * 24-hour view of a twenty-year mission without the axis having changed.
     */
    granularity: TimeMode
    /**
     * Asks for the global window to be opened to the span given. Called only
     * when a fit reaches data outside the current window, and only ever
     * outward. The hook knows nothing about the message bus.
     */
    onBoundsWiden: (start: Date, end: Date) => void
}

export interface TimelineZoom {
    /**
     * The visible window — the source of truth the d3 transform derives
     * from. While a zoom or fit is in transition it is the window on screen
     * on that frame, so the slider and the chart move together.
     */
    view: ViewWindow
    autoFit: boolean
    /** Where the view sits on the logarithmic slider, 0 (full) to 1 (floor). */
    sliderValue: number
    /** False when the global window has no more travel than the floor. */
    canZoom: boolean
    /** False when no visible layer carries bounds of its own to frame. */
    canFit: boolean
    /** Halves the span, in transition. Instant under reduced motion. */
    zoomIn(): void
    /** Doubles the span, in transition. Instant under reduced motion. */
    zoomOut(): void
    /** Direct manipulation: takes effect at once and drops any transition. */
    setSliderValue(v: number): void
    /** Direct manipulation: takes effect at once and drops any transition. */
    setView(win: ViewWindow): void
    toggleAutoFit(): void
    /** Frames the visible layers' own bounds, in transition. */
    fitToLayers(): void
    /** Frames one layer's span, in transition. */
    fitToLayer(layer: LayerTimeData): void
    /**
     * Pans the view, at the span it has, to bring `at` on screen: centred on
     * it, or stopped at the edge of the global window where centring would
     * pass it. Nothing moves when `at` is already in view. Auto-fit is left
     * as it stands: only its toggle disarms it. In transition; instant under
     * reduced motion.
     */
    revealTime(at: Date): void
}

/**
 * The instant a fit must open the view at to show a layer's first data. A
 * sparse layer's start is a stop at its first listed day's last instant, but
 * the chart draws that day as a whole-day box from the day's first instant,
 * so a view opening at the stop meets the box's trailing edge and leaves the
 * whole first day off the left of the chart. The end needs no allowance: a
 * box ends on the instant its day does. A periodic start is returned as is.
 *
 * The revealed start is a fixed function of the layer's own listed days and
 * never of the global window, so a widen to it is a fixed point: the refetch
 * that follows finds the same instant, not one moved outward again.
 */
const framedStart = (nav: LayerNavigation): Date => revealStart(nav, nav.start)

/**
 * The span a layer contributes to an automatic fit: only the bounds it named
 * itself, with a borrowed side left out entirely.
 *
 * A borrowed bound is the global window's own edge, so a union reading one
 * reaches that edge, and the fit opens the view out to the whole window and
 * hides the layer's real extent — the one thing a fit exists to show. Leaving
 * borrowed sides out is what makes a fit frame data.
 *
 * It is not what makes a fit terminate. A borrowed bound can equal the window
 * edge but never exceed it, and a widen goes only to the unpadded union on a
 * strict excess, so even a union reading borrowed bounds would widen once and
 * settle; the refetch a widen causes also leaves the signature unchanged, so
 * nothing would refire it. Were a widen ever padded, a borrowed bound would
 * follow the padding outward on each refetch, and this cut would then also be
 * what stopped a fit chasing its own widening.
 */
const ownExtent = (layer: LayerTimeData): ViewWindow | null => {
    const nav = layer.navigation
    if (!nav) return null
    if (!nav.hasOwnStart && !nav.hasOwnEnd) return null
    const start = framedStart(nav)
    return {
        start: nav.hasOwnStart ? start : nav.end,
        end: nav.hasOwnEnd ? nav.end : start,
    }
}

/**
 * What an automatic refit keys on: each visible layer's own bounds, quantised
 * to the displayed unit.
 *
 * Quantising bounds the rate at which an open-ended layer can reclaim the view
 * to once per displayed unit. `dataEndTime: 'now'` resolves to a different
 * instant on every fetch, so an unquantised key would refire on every refetch
 * and take the view back from a user who had zoomed by hand.
 *
 * Keying on a signature rather than on the `layers` array identity matters for
 * the same reason: the layer fetch re-runs on every change to the global
 * window, including the plugin's own widen.
 */
const layersSignature = (
    layers: LayerTimeData[],
    granularity: TimeMode
): string => {
    const unit = SIGNATURE_UNIT[granularity]
    const floor = (date: Date) => String(moment.utc(date).startOf(unit).valueOf())

    return layers
        .map((layer) => {
            const nav = layer.navigation
            const start = nav?.hasOwnStart ? floor(nav.start) : '-'
            const end = nav?.hasOwnEnd ? floor(nav.end) : '-'
            return `${layer.name}:${start}:${end}`
        })
        .sort()
        .join('|')
}

/** The scrubber when it is on screen, or the view's centre when it is not. */
const anchorIn = (win: ViewWindow, at: Date): Date => {
    const ms = at.getTime()
    if (ms >= win.start.getTime() && ms <= win.end.getTime()) return at
    return new Date(Math.round((win.start.getTime() + win.end.getTime()) / 2))
}

/**
 * The visible window, and everything that moves it.
 *
 * The window is the source of truth and the d3 transform is derived from it,
 * rather than the other way round: the alternative spreads the same arithmetic
 * across every control and never produces the timestamp pair the rest of the
 * feature is expressed in.
 */
export function useTimelineZoom({
    bounds,
    layers,
    currentTime,
    granularity,
    onBoundsWiden,
}: UseTimelineZoomOptions): TimelineZoom {
    const minMs = useMemo(() => minViewDuration(granularity), [granularity])

    const [view, setViewState] = useState<ViewWindow>(() => ({
        start: bounds.start,
        end: bounds.end,
    }))
    const [autoFit, setAutoFit] = useState(true)

    /**
     * A widen this hook has asked for and core has not yet committed. The span
     * the view may occupy is the global window opened out to it, so a fit that
     * reaches outside the window is in range from the render it lands in, and
     * the slider and buttons read against the span the fit was made for rather
     * than the one core still holds. Cleared once the window covers it, so a
     * later narrowing by core is not masked.
     */
    const [widened, setWidened] = useState<ViewWindow | null>(null)

    // The global window is tracked by value, not by the identity of the object
    // carrying it: the parent may rebuild an unchanged window as a fresh
    // object on any render, and that is not a change to the span.
    const boundsStartMs = bounds.start.getTime()
    const boundsEndMs = bounds.end.getTime()
    const effectiveStartMs = widened
        ? Math.min(boundsStartMs, widened.start.getTime())
        : boundsStartMs
    const effectiveEndMs = widened
        ? Math.max(boundsEndMs, widened.end.getTime())
        : boundsEndMs
    const effectiveBounds = useMemo<ViewWindow>(
        () => ({ start: new Date(effectiveStartMs), end: new Date(effectiveEndMs) }),
        [effectiveStartMs, effectiveEndMs]
    )

    useEffect(() => {
        if (!widened) return
        const covered =
            boundsStartMs <= widened.start.getTime() &&
            boundsEndMs >= widened.end.getTime()
        if (covered) setWidened(null)
    }, [boundsStartMs, boundsEndMs, widened])

    // The span can move under the view — core commits a window, or a fit opens
    // one out — so the view is brought back into range as part of the render
    // that sees the move, never painted out of range in between. Reconciling
    // here rather than in an effect also keeps a development-mode effect
    // replay from queueing a clamp against the span of the render before a
    // fit, which would land after the fit and undo it. This settles in one
    // pass because clamping an already-clamped window returns it unchanged.
    const inRange = clampWindow(view, effectiveBounds, minMs)
    if (!sameWindow(view, inRange)) setViewState(inRange)

    // Read by callbacks and updaters that must not be rebuilt on every
    // scrubber frame or every echo of the window from core.
    const boundsRef = useRef(effectiveBounds)
    const currentTimeRef = useRef(currentTime)
    const widenRef = useRef(onBoundsWiden)
    useEffect(() => {
        boundsRef.current = effectiveBounds
    }, [effectiveBounds])
    useEffect(() => {
        currentTimeRef.current = currentTime
    }, [currentTime])
    useEffect(() => {
        widenRef.current = onBoundsWiden
    }, [onBoundsWiden])

    // The view as the actions see it. Written by every commit as well as
    // synced from state, so two presses landing in one batch each act on the
    // other's result instead of both on the view as it stood before either,
    // and `commit` compares against it to skip a frame that changes nothing.
    const viewRef = useRef(view)
    useEffect(() => {
        viewRef.current = view
    }, [view])

    // Every action that moves the view ends here; the reconciliation above
    // is the one other writer, and the ref catches up with it in the effect
    // above. Not clamped: a fit's window can lie in a span the render has
    // yet to see, since the widen it made lands in the same render as the
    // window, and the reconciliation brings any window into range as part
    // of the render that sees it.
    const commit = useCallback((next: ViewWindow) => {
        if (sameWindow(viewRef.current, next)) return
        viewRef.current = next
        setViewState(next)
    }, [])

    const transition = useWindowTransition(commit)

    // A gesture is the user's own hand on the view: it takes effect at once,
    // and a transition still running would only fight it.
    const setView = useCallback(
        (next: ViewWindow) => {
            transition.cancel()
            commit(clampWindow(next, boundsRef.current, minMs))
        },
        [transition, commit, minMs]
    )

    // A press landing mid-flight steps from the flight's destination, not
    // from wherever that frame happens to be, so a run of quick presses is a
    // run of whole steps; the flight restarts from the view as it stands, so
    // nothing on screen jumps. The anchor the step was placed about is also
    // what the flight pivots on, so the scrubber holds its pixel from the
    // first frame to the last rather than only at the ends.
    const zoomBy = useCallback(
        (factor: number) => {
            const origin = transition.target() ?? viewRef.current
            const anchor = anchorIn(origin, currentTimeRef.current)
            const next = zoomAround(
                origin,
                factor,
                anchor,
                boundsRef.current,
                minMs
            )
            transition.animateTo(viewRef.current, next, anchor)
        },
        [transition, minMs]
    )

    const zoomIn = useCallback(() => zoomBy(ZOOM_IN_FACTOR), [zoomBy])
    const zoomOut = useCallback(() => zoomBy(ZOOM_OUT_FACTOR), [zoomBy])

    const setSliderValue = useCallback(
        (v: number) => {
            transition.cancel()
            const held = viewRef.current
            commit(
                sliderToWindow(
                    v,
                    held,
                    anchorIn(held, currentTimeRef.current),
                    boundsRef.current,
                    minMs
                )
            )
        },
        [transition, commit, minMs]
    )

    /**
     * Frames the extents given, opening the global window first when they
     * reach outside it. Widening follows the per-layer navigation controls,
     * which already open the window to reach data beyond it; the consequence
     * is that the window ratchets outward across a session, since hiding a
     * layer narrows the view without shrinking the window back.
     *
     * A widen goes to the unpadded union, only on a strict excess, and never
     * shrinks the window. That is what makes a fit terminate: the refetch a
     * widen causes completes each borrowed bound to the widened edge exactly,
     * which is no excess, so a second pass has nothing left to widen to. What
     * makes a fit meaningful is the union reading own bounds only, which is
     * `ownExtent`'s concern.
     */
    const applyFit = useCallback(
        (extents: ViewWindow[]) => {
            if (extents.length === 0) return

            const held = boundsRef.current
            let unionStart = Infinity
            let unionEnd = -Infinity
            for (const extent of extents) {
                unionStart = Math.min(unionStart, extent.start.getTime())
                unionEnd = Math.max(unionEnd, extent.end.getTime())
            }

            const widenStart = unionStart < held.start.getTime()
            const widenEnd = unionEnd > held.end.getTime()
            const target: ViewWindow = {
                start: widenStart ? new Date(unionStart) : held.start,
                end: widenEnd ? new Date(unionEnd) : held.end,
            }

            if (widenStart || widenEnd) {
                setWidened(target)
                widenRef.current(target.start, target.end)
            }

            const fitted = fitWindow(extents, target, minMs, PAD_FRACTION)
            if (!fitted) return
            transition.animateTo(viewRef.current, fitted)
        },
        [transition, minMs]
    )

    const ownExtents = useMemo(
        () =>
            layers
                .map(ownExtent)
                .filter((extent): extent is ViewWindow => extent !== null),
        [layers]
    )

    const signature = useMemo(
        () => layersSignature(layers, granularity),
        [layers, granularity]
    )

    // The signature the view was last fitted to. Null arms an immediate refit.
    const fittedSignatureRef = useRef<string | null>(null)

    // Re-runs whenever the layer array is rebuilt, which the fetch does on
    // every window change; the signature check is what makes those no-ops.
    useEffect(() => {
        if (!autoFit) return
        if (fittedSignatureRef.current === signature) return
        fittedSignatureRef.current = signature
        applyFit(ownExtents)
    }, [autoFit, signature, applyFit, ownExtents])

    const fitToLayers = useCallback(() => {
        fittedSignatureRef.current = signature
        applyFit(ownExtents)
    }, [applyFit, ownExtents, signature])

    /**
     * Frames one layer, on demand. Unlike the automatic union this reads the
     * navigation extent as drawn, borrowed side and all: it is a single press
     * with nothing to re-trigger it, so it frames what the row shows.
     */
    const fitToLayer = useCallback(
        (layer: LayerTimeData) => {
            const nav = layer.navigation
            if (!nav) return
            applyFit([{ start: framedStart(nav), end: nav.end }])
        },
        [applyFit]
    )

    // An instant waiting to be revealed, and a count bumped with each request
    // so the render that carries it runs the effect below even when nothing
    // else in the hook changed.
    const pendingRevealRef = useRef<Date | null>(null)
    const [revealRequest, setRevealRequest] = useState(0)

    const revealTime = useCallback((at: Date) => {
        pendingRevealRef.current = at
        setRevealRequest((count) => count + 1)
    }, [])

    // Applied once the request's render commits rather than when it is made.
    // A layer control, or a commit from outside the plugin, moves the global
    // window in the same batch as it asks for the reveal, so at the call the
    // hook holds only the window from before; clamped against that, a
    // target past the old edge would be slid straight back out of view. The
    // render that carries the request also carries the moved window, and the
    // effect clamps against that render's span. The request is consumed from
    // the ref, so an effect re-run with nothing new to reveal does nothing.
    //
    // Measured from the destination of a transition in flight, as a zoom
    // press is, so a reveal landing mid-flight whose instant the flight is
    // already heading to show leaves the flight to finish. Declared after
    // the auto-fit effect, so a refit started in the same render is the
    // origin the reveal measures from and, when it has to pan, the flight
    // the reveal replaces.
    //
    // Auto-fit stays armed through a pan. The refit it arms keys on the
    // layers' own bounds, which a reveal does not touch, and the refetch a
    // widen causes leaves them as they were, so the view stays on the
    // revealed instant until the layer set itself changes.
    useEffect(() => {
        const at = pendingRevealRef.current
        if (!at) return
        pendingRevealRef.current = null

        const origin = transition.target() ?? viewRef.current
        const next = revealWindow(origin, at, effectiveBounds, minMs)
        if (next === origin || sameWindow(next, origin)) return

        transition.animateTo(viewRef.current, next)
    }, [revealRequest, effectiveBounds, transition, minMs])

    /**
     * Records standing intent, not the last action: a manual zoom holds the
     * view and leaves the toggle lit, and the next change to the signature
     * refits. Arming clears the fitted signature so the press itself refits,
     * even when nothing has changed since the last fit.
     */
    const toggleAutoFit = useCallback(() => {
        if (autoFit) {
            setAutoFit(false)
            return
        }
        fittedSignatureRef.current = null
        setAutoFit(true)
    }, [autoFit])

    const sliderValue = useMemo(
        () => windowToSlider(view, effectiveBounds, minMs),
        [view, effectiveBounds, minMs]
    )

    const canZoom = effectiveEndMs - effectiveStartMs > minMs

    return {
        view,
        autoFit,
        sliderValue,
        canZoom,
        canFit: ownExtents.length > 0,
        zoomIn,
        zoomOut,
        setSliderValue,
        setView,
        toggleAutoFit,
        fitToLayers,
        fitToLayer,
        revealTime,
    }
}
