import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import moment from 'moment'
import type { LayerTimeData, TimeMode } from '../types'
import {
    clampWindow,
    fitWindow,
    minViewDuration,
    sliderToWindow,
    windowToSlider,
    zoomAround,
    type ViewWindow,
} from '../utils/zoomWindow'

/** How much of the union's span a fit leaves clear at each edge. */
const PAD_FRACTION = 0.04

/** The `±` buttons' scaling factors. */
const ZOOM_IN_FACTOR = 0.5
const ZOOM_OUT_FACTOR = 2

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
    /** The visible window — the source of truth the d3 transform derives from. */
    view: ViewWindow
    autoFit: boolean
    /** Where the view sits on the logarithmic slider, 0 (full) to 1 (floor). */
    sliderValue: number
    /** False when the global window has no more travel than the floor. */
    canZoom: boolean
    /** False when no visible layer carries bounds of its own to frame. */
    canFit: boolean
    zoomIn(): void
    zoomOut(): void
    setSliderValue(v: number): void
    setView(win: ViewWindow): void
    toggleAutoFit(): void
    fitToLayers(): void
    fitToLayer(layer: LayerTimeData): void
}

/** The quantisation unit a signature floors each bound to, by granularity. */
const SIGNATURE_UNIT: Record<TimeMode, moment.unitOfTime.StartOf> = {
    HOUR: 'hour',
    DAY: 'day',
    MONTH: 'month',
    YEAR: 'year',
}

/**
 * The span a layer contributes to an automatic fit: only the bounds it named
 * itself, with a borrowed side left out entirely.
 *
 * This is what keeps a refit from chasing its own widening. A bound completed
 * from the global window grows every time that window grows, so a union
 * reading one would widen, be re-fetched wider, and widen again.
 */
const ownExtent = (layer: LayerTimeData): ViewWindow | null => {
    const nav = layer.navigation
    if (!nav) return null
    if (!nav.hasOwnStart && !nav.hasOwnEnd) return null
    return {
        start: nav.hasOwnStart ? nav.start : nav.end,
        end: nav.hasOwnEnd ? nav.end : nav.start,
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

const sameWindow = (a: ViewWindow, b: ViewWindow): boolean =>
    a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime()

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

    // Read by callbacks that must not be rebuilt on every scrubber frame or
    // every echo of the window from core.
    const viewRef = useRef(view)
    const boundsRef = useRef(bounds)
    const currentTimeRef = useRef(currentTime)
    const widenRef = useRef(onBoundsWiden)
    useEffect(() => {
        viewRef.current = view
    }, [view])
    useEffect(() => {
        currentTimeRef.current = currentTime
    }, [currentTime])
    useEffect(() => {
        widenRef.current = onBoundsWiden
    }, [onBoundsWiden])

    // The global window is tracked by value, not by the identity of the object
    // carrying it. A fit that widens the window holds the widened span here
    // until core commits it; in between, the parent may re-render with the old
    // span rebuilt as a fresh object, and reacting to that identity would put
    // the stale span back and clamp the fitted view inside it.
    const boundsStartMs = bounds.start.getTime()
    const boundsEndMs = bounds.end.getTime()
    useEffect(() => {
        boundsRef.current = bounds
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boundsStartMs, boundsEndMs])

    const setView = useCallback(
        (next: ViewWindow) => {
            setViewState((prev) => {
                const clamped = clampWindow(next, boundsRef.current, minMs)
                return sameWindow(prev, clamped) ? prev : clamped
            })
        },
        [minMs]
    )

    // The global window can move under the view — core commits a window, or
    // this plugin widens one — so the view is brought back into range.
    useEffect(() => {
        setViewState((prev) => {
            const clamped = clampWindow(prev, bounds, minMs)
            return sameWindow(prev, clamped) ? prev : clamped
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boundsStartMs, boundsEndMs, minMs])

    /** The scrubber, or the view's centre when the scrubber is off screen. */
    const anchorIn = (win: ViewWindow): Date => {
        const at = currentTimeRef.current.getTime()
        if (at >= win.start.getTime() && at <= win.end.getTime())
            return currentTimeRef.current
        return new Date(Math.round((win.start.getTime() + win.end.getTime()) / 2))
    }

    const zoomBy = useCallback(
        (factor: number) => {
            const held = viewRef.current
            setView(
                zoomAround(held, factor, anchorIn(held), boundsRef.current, minMs)
            )
        },
        [minMs, setView]
    )

    const zoomIn = useCallback(() => zoomBy(ZOOM_IN_FACTOR), [zoomBy])
    const zoomOut = useCallback(() => zoomBy(ZOOM_OUT_FACTOR), [zoomBy])

    const setSliderValue = useCallback(
        (v: number) => {
            const held = viewRef.current
            setView(sliderToWindow(v, anchorIn(held), boundsRef.current, minMs))
        },
        [minMs, setView]
    )

    /**
     * Frames the extents given, opening the global window first when they
     * reach outside it. Widening follows the per-layer navigation controls,
     * which already open the window to reach data beyond it; the consequence
     * is that the window ratchets outward across a session, since hiding a
     * layer narrows the view without shrinking the window back.
     *
     * A widen is emitted only on a strict excess, and never shrinks the
     * window. That is defence in depth behind the union and signature cuts
     * above, not the mechanism that makes this terminate.
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
                boundsRef.current = target
                widenRef.current(target.start, target.end)
            }

            const fitted = fitWindow(extents, target, minMs, PAD_FRACTION)
            if (!fitted) return
            setViewState((prev) => (sameWindow(prev, fitted) ? prev : fitted))
        },
        [minMs]
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
    const extentsRef = useRef(ownExtents)
    useEffect(() => {
        extentsRef.current = ownExtents
    }, [ownExtents])

    useEffect(() => {
        if (!autoFit) return
        if (fittedSignatureRef.current === signature) return
        fittedSignatureRef.current = signature
        applyFit(extentsRef.current)
    }, [autoFit, signature, applyFit])

    const fitToLayers = useCallback(() => {
        fittedSignatureRef.current = layersSignature(layers, granularity)
        applyFit(extentsRef.current)
    }, [applyFit, layers, granularity])

    /**
     * Frames one layer, on demand. Unlike the automatic union this reads the
     * navigation extent as drawn, borrowed side and all: it is a single press
     * with nothing to re-trigger it, so it frames what the row shows.
     */
    const fitToLayer = useCallback(
        (layer: LayerTimeData) => {
            const nav = layer.navigation
            if (!nav) return
            applyFit([{ start: nav.start, end: nav.end }])
        },
        [applyFit]
    )

    /**
     * Records standing intent, not the last action: a manual zoom holds the
     * view and leaves the toggle lit, and the next change to the signature
     * refits. Arming clears the fitted signature so the press itself refits.
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
        () => windowToSlider(view, bounds, minMs),
        [view, bounds, minMs]
    )

    const canZoom = bounds.end.getTime() - bounds.start.getTime() > minMs

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
    }
}
