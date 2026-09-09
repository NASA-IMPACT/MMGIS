import moment from 'moment'
import type { TimeMode } from '../types'
import { resolveLayerExtent, stepTime } from './timeUtils'
import type { LayerTimeConfig } from './timeUtils'

/**
 * Where a layer's navigation controls can put the timeline's current time. A
 * sparse layer lists the days it holds data for and carries them as stops; a
 * periodic layer holds data throughout its extent, so its bounds are enough.
 */
export interface LayerNavigation {
    kind: 'sparse' | 'periodic'
    /** Sparse only: one stop per listed day, sorted ascending, deduplicated. */
    stops?: Date[]
    /** The span covered — for a sparse layer, its outermost stops. */
    start: Date
    end: Date
}

/**
 * The navigation model for a layer, or null when there is nothing to navigate:
 * the layer is not time-enabled, or names no instant to move to.
 *
 * Listed days must be ISO 8601, give or take surrounding whitespace;
 * unreadable ones are dropped, and a list with nothing readable in it leaves
 * the layer navigating its extent. A stop sits on the day's last UTC instant:
 * the current time is assigned to each layer as `layer.time.end`, so a stop at
 * midnight would close the query window before the day's data fell inside it.
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

    const listed = Array.isArray(time.dataDates)
        ? time.dataDates
        : typeof time.dataDates === 'string'
        ? [time.dataDates]
        : []

    // Several instants on one day are one day of data, and so one stop. The
    // set collapses them in one pass, for a layer that can list a stop a day
    // over years.
    const stops = [
        ...new Set(
            listed
                .map((date) =>
                    moment.utc(String(date).trim(), moment.ISO_8601, true)
                )
                .filter((day) => day.isValid())
                .map((day) => day.endOf('day').valueOf())
        ),
    ]
        .sort((a, b) => a - b)
        .map((stop) => new Date(stop))

    if (stops.length > 0)
        return {
            kind: 'sparse',
            stops,
            start: stops[0],
            end: stops[stops.length - 1],
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
    if (!hasOwnStart && start > end) return { kind: 'periodic', start: end, end }
    if (!hasOwnEnd && end < start) return { kind: 'periodic', start, end: start }

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

    return { kind: 'periodic', start, end }
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
 * The periodic half of `navigateLayer`. Data runs throughout the extent, so
 * moving inside it steps by the timeline's granularity and stops short at the
 * edges; one press from outside reaches the near edge.
 */
function navigatePeriodicLayer(
    start: Date,
    end: Date,
    from: Date,
    action: 'first' | 'prev' | 'next' | 'last',
    mode: TimeMode
): Date | null {
    const at = from.getTime()
    const startMs = start.getTime()
    const endMs = end.getTime()

    switch (action) {
        case 'first':
            return at === startMs ? null : start
        case 'last':
            return at === endMs ? null : end
        case 'next':
            if (at < startMs) return start
            if (at >= endMs) return null
            return new Date(Math.min(stepTime(from, mode, 1).getTime(), endMs))
        case 'prev':
            if (at > endMs) return end
            if (at <= startMs) return null
            return new Date(Math.max(stepTime(from, mode, -1).getTime(), startMs))
    }
}

/**
 * Where a layer's first/previous/next/last control puts the current time, or
 * null when that control has nowhere to go — the signal a layer row draws it
 * inert. `mode` is read only by the periodic side; a sparse layer moves
 * between its own stops regardless of it.
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
        : navigatePeriodicLayer(nav.start, nav.end, from, action, mode)
}
