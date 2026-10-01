import type { TimeMode } from '../types'
import { resolveLayerExtent, resolveListedEntries, stepTime } from './timeUtils'
import type { LayerTimeConfig } from './timeUtils'
import { addSteps, parseDuration, stepIndexAtOrBefore } from './duration'
import type { Duration } from './duration'

/**
 * Where a layer's navigation controls can put the timeline's current time. A
 * sparse layer lists the instants it holds data at and carries them as stops;
 * a periodic layer holds data throughout its extent, so its bounds are enough.
 */
export interface LayerNavigation {
    kind: 'sparse' | 'periodic'
    /** Sparse only: one stop per distinct listed instant, sorted ascending. */
    stops?: Date[]
    /**
     * Sparse only, aligned with `stops`: the periods the entries landing on
     * each stop cover, as the row draws them. A stop opens its period, or
     * sits partway into its hour when the entry gives minutes or seconds.
     */
    stopSpans?: { start: Date; end: Date }[]
    /** The span covered — for a sparse layer, its outermost stops. */
    start: Date
    end: Date
    /**
     * False when `dataStartTime` names no readable bound: `start` was then
     * completed from the timeline's window, or closed on the layer's own end.
     */
    hasOwnStart: boolean
    /**
     * False when `dataEndTime` names no readable bound: `end` was then
     * completed from the timeline's window, or closed on the layer's own start.
     */
    hasOwnEnd: boolean
    /**
     * Periodic only: the Data Time Interval the layer's data repeats at, its
     * steps anchored at `start`. Absent when the layer names no readable
     * interval, or no start of its own to anchor one to, in which case the
     * layer is drawn as one span and stepped by the timeline's granularity.
     */
    interval?: Duration
}

/**
 * The navigation model for a layer, or null when there is nothing to navigate:
 * the layer is not time-enabled, or names no instant to move to.
 *
 * A list with nothing readable in it leaves the layer navigating its extent.
 * A stop is the instant an entry names, so a layer that lists the exact
 * times it has data at is navigated to those times and requests them. An
 * entry that leaves parts out names a period, and its stop is the period's
 * first UTC instant: 2020-03 lands on 1 March 00:00, 2020-03-04 on that
 * day's midnight, 2020-03-04T14 on 14:00.
 *
 * An unconfigured bound is completed from the timeline's window, so the
 * controls move through the span the layer's bar is drawn over.
 *
 * `layerName` names the layer in the warning a self-contradictory extent
 * raises, and is otherwise unread.
 */
export function resolveLayerNavigation(
    time: LayerTimeConfig | undefined,
    fallbackStart: Date,
    fallbackEnd: Date,
    layerName?: string
): LayerNavigation | null {
    if (!time || time.enabled !== true) return null

    const byStop = new Map<number, { start: Date; end: Date }>()
    resolveListedEntries(time).forEach((entry) => {
        const at = entry.at.getTime()
        const held = byStop.get(at)
        byStop.set(at, {
            start: held && held.start < entry.start ? held.start : entry.start,
            end: held && held.end > entry.end ? held.end : entry.end,
        })
    })
    const stopMs = [...byStop.keys()].sort((a, b) => a - b)
    const stops = stopMs.map((ms) => new Date(ms))

    if (stops.length > 0)
        return {
            kind: 'sparse',
            stops,
            stopSpans: stopMs.map((ms) => byStop.get(ms)!),
            start: stops[0],
            end: stops[stops.length - 1],
            // A sparse layer's stops are read from its own list, so neither
            // outermost stop was completed from the timeline's window.
            hasOwnStart: true,
            hasOwnEnd: true,
        }

    const { start, end, hasOwnStart, hasOwnEnd } = resolveLayerExtent(
        time,
        fallbackStart,
        fallbackEnd
    )

    if (!hasOwnStart && !hasOwnEnd) return null

    // A window lying wholly to one side of the layer's single configured bound
    // would complete the open side past it, running the extent backwards
    // through a span the layer holds no data for. Close on the bound the layer
    // names instead, leaving the open direction inert.
    if (!hasOwnStart && start > end)
        return { kind: 'periodic', start: end, end, hasOwnStart, hasOwnEnd }
    if (!hasOwnEnd && end < start)
        return { kind: 'periodic', start, end: start, hasOwnStart, hasOwnEnd }

    // Both bounds named, and the end before the start: a span the layer cannot
    // hold data in. Every direction through it contradicts another — first
    // lands past last, next past prev — so the row goes without controls
    // rather than carrying four that disagree, and the config is reported.
    if (start > end) {
        console.warn(
            `[Timeline] Layer ${layerName ?? '(unnamed)'} has dataStartTime ` +
                `(${start.toISOString()}) after dataEndTime ` +
                `(${end.toISOString()}); its date navigation is switched off.`
        )
        return null
    }

    // Steps are anchored at the layer's own start. A start borrowed from the
    // timeline's window moves with the window, so it anchors nothing.
    const interval = hasOwnStart ? parseDuration(time.interval) : null

    return {
        kind: 'periodic',
        start,
        end,
        hasOwnStart,
        hasOwnEnd,
        ...(interval ? { interval } : {}),
    }
}

/** The period a sparse stop's entries cover, or null off every stop. */
function spanAtStop(
    nav: LayerNavigation,
    target: Date
): { start: Date; end: Date } | null {
    if (nav.kind !== 'sparse' || !nav.stops || !nav.stopSpans) return null
    const i = nav.stops.findIndex((stop) => stop.getTime() === target.getTime())
    return i === -1 ? null : nav.stopSpans[i]
}

/**
 * The earliest instant the timeline's window must include for what a target
 * lands on to be visible in the chart. A sparse stop opens the box its period
 * draws, or sits partway into its hour, so the window has to open at the
 * box's start for the whole of it to be inside. A periodic layer's bounds
 * are instants rather than spans, and its bar runs inward from them, so the
 * window meets them exactly.
 */
export function revealStart(nav: LayerNavigation, target: Date): Date {
    return spanAtStop(nav, target)?.start ?? target
}

/**
 * The latest instant the timeline's window must include for what a target
 * lands on to be visible: the close of the box a sparse stop opens, since a
 * window ending at the stop would leave all of a month's or year's box off
 * the right of the chart. A periodic target is met exactly.
 */
export function revealEnd(nav: LayerNavigation, target: Date): Date {
    return spanAtStop(nav, target)?.end ?? target
}

/**
 * The span a layer's row draws over: a sparse layer's earliest box start to
 * its latest box end, which a coarse entry can carry past the last stop, and
 * a periodic layer's bounds.
 */
export function drawnExtent(nav: LayerNavigation): { start: Date; end: Date } {
    if (nav.kind !== 'sparse' || !nav.stopSpans || nav.stopSpans.length === 0)
        return { start: nav.start, end: nav.end }
    let start = nav.stopSpans[0].start
    let end = nav.stopSpans[0].end
    nav.stopSpans.forEach((span) => {
        if (span.start < start) start = span.start
        if (span.end > end) end = span.end
    })
    return { start, end }
}

/**
 * The sparse half of `navigateLayer`. Moving lands on the nearest stop the
 * other side of the current time, however far away, so one press reaches data
 * sitting months from the timeline. Comparisons are strict, so a press from an
 * instant already on a stop moves off it rather than stalling there.
 */
function navigateSparseLayer(
    stops: Date[],
    from: Date,
    action: 'first' | 'prev' | 'next' | 'last'
): Date | null {
    if (stops.length === 0) return null

    const at = from.getTime()
    const firstStop = stops[0]
    const lastStop = stops[stops.length - 1]

    switch (action) {
        case 'first':
            return firstStop.getTime() === at ? null : firstStop
        case 'last':
            return lastStop.getTime() === at ? null : lastStop
        case 'next':
            return stops.find((stop) => stop.getTime() > at) ?? null
        case 'prev':
            // Scanned from the far end rather than filtered: a row asks on
            // every frame of a drag, for a layer that can list a stop a day
            // over years.
            for (let i = stops.length - 1; i >= 0; i--)
                if (stops[i].getTime() < at) return stops[i]
            return null
    }
}

/**
 * The instant one step of the layer's own cadence from `from`: the next or
 * previous step boundary, anchored at the layer's start. Strict, so a press
 * from a boundary moves a whole step, and one from between two boundaries
 * lands on the nearer one in the direction pressed.
 */
function stepByInterval(
    anchor: Date,
    interval: Duration,
    from: Date,
    direction: 1 | -1
): Date {
    const n = stepIndexAtOrBefore(anchor, interval, from)
    if (direction === 1) return addSteps(anchor, interval, n + 1)
    const onBoundary = addSteps(anchor, interval, n).getTime() === from.getTime()
    return addSteps(anchor, interval, onBoundary ? n - 1 : n)
}

/**
 * The periodic half of `navigateLayer`. Data runs throughout the extent, so
 * moving inside it steps by the layer's own interval where it names one, and
 * by the timeline's granularity where it does not, stopping short at the
 * edges; one press from outside reaches the near edge.
 */
function navigatePeriodicLayer(
    nav: LayerNavigation,
    from: Date,
    action: 'first' | 'prev' | 'next' | 'last',
    mode: TimeMode
): Date | null {
    const { start, end, interval } = nav
    const at = from.getTime()
    const startMs = start.getTime()
    const endMs = end.getTime()
    const step = (direction: 1 | -1) =>
        interval
            ? stepByInterval(start, interval, from, direction)
            : stepTime(from, mode, direction)

    switch (action) {
        case 'first':
            return at === startMs ? null : start
        case 'last':
            return at === endMs ? null : end
        case 'next': {
            if (at < startMs) return start
            if (at >= endMs) return null
            // A step past the range a Date can hold overshoots the extent.
            const next = step(1).getTime()
            return Number.isFinite(next) ? new Date(Math.min(next, endMs)) : end
        }
        case 'prev': {
            if (at > endMs) return end
            if (at <= startMs) return null
            const prev = step(-1).getTime()
            return Number.isFinite(prev) ? new Date(Math.max(prev, startMs)) : start
        }
    }
}

/**
 * Where a layer's first/previous/next/last control puts the current time, or
 * null when that control has nowhere to go — the signal a layer row draws it
 * inert. `mode` is read only by a periodic layer without an interval of its
 * own; a sparse layer moves between its own stops regardless of it.
 *
 * A jump to an outermost instant the current time already sits on is nowhere
 * to go: repeating it would re-commit the time already held while the control
 * went on looking live.
 */
export function navigateLayer(
    nav: LayerNavigation,
    from: Date,
    action: 'first' | 'prev' | 'next' | 'last',
    mode: TimeMode
): Date | null {
    return nav.kind === 'sparse'
        ? navigateSparseLayer(nav.stops ?? [], from, action)
        : navigatePeriodicLayer(nav, from, action, mode)
}
