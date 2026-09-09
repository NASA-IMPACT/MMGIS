import moment from 'moment'
import type { TimeMode } from '../types'
import { resolveLayerExtent, stepTime } from './timeUtils'
import type { LayerTimeConfig } from './timeUtils'

/**
 * Where a layer's navigation controls can put the timeline's current time.
 *
 * A sparse layer — one that lists the days it holds data for — can only be
 * navigated to those days, so it carries them as stops. A periodic layer holds
 * data throughout its extent, so its bounds are all the model needs.
 */
export interface LayerNavigation {
    kind: 'sparse' | 'periodic'
    /** Sparse only: one stop per listed day, sorted ascending, deduplicated. */
    stops?: Date[]
    /**
     * The extent a periodic layer's controls move through. A sparse layer
     * carries its first and last stop here to describe the span it covers;
     * its controls move between the stops themselves.
     */
    start: Date
    end: Date
}

/**
 * The navigation model for a layer, or null when there is nothing to navigate:
 * the layer is not time-enabled, or its configuration names no instant the
 * timeline could move to.
 *
 * Listed days are read the way the timeline reads them for drawing, so the
 * stops line up with the boxes the row shows — with the one difference that a
 * day listed twice is a single stop, where drawing gives each listing its own
 * box and the two land exactly on top of each other. Days must be written as
 * ISO 8601, give or take the whitespace a comma-separated list picks up;
 * unreadable ones are dropped rather than guessed at, and a list with nothing
 * readable in it leaves the layer navigating its extent instead. The extent
 * either side is read leniently, since configs carry values in looser formats.
 *
 * Both halves of the extent are configured independently, so a layer often
 * names one bound and leaves the other open. The open side is completed from
 * the timeline's own window, the same way the layer's bar is drawn, so the
 * controls move through exactly the span the row shows — except where the
 * window lies wholly the far side of the configured bound, when the extent
 * closes on that bound instead of running backwards through a span the layer
 * has no data for.
 *
 * A stop sits on the day's last UTC instant rather than its first. The current
 * time is assigned to each time-enabled layer as `layer.time.end`, making it
 * the trailing edge of the layer's query window; closing that window at
 * midnight would exclude everything the layer acquired over the rest of the
 * day, so navigating onto a data day would show nothing. Days are bounded in
 * UTC like every other instant the plugin handles — snapping them locally would
 * shift each stop off the day it names by the viewer's offset.
 */
export function resolveLayerNavigation(
    time: LayerTimeConfig | undefined,
    fallbackStart: Date,
    fallbackEnd: Date
): LayerNavigation | null {
    if (!time || time.enabled !== true) return null

    const listed = Array.isArray(time.dataDates)
        ? time.dataDates
        : typeof time.dataDates === 'string'
        ? [time.dataDates]
        : []

    const stops = listed
        .map((date) => moment.utc(String(date).trim(), moment.ISO_8601, true))
        .filter((day) => day.isValid())
        .map((day) => day.endOf('day').valueOf())
        // Several instants on one day describe one day of data, and so one
        // stop; the controls would otherwise stall on a day listed twice.
        .filter((stop, i, all) => all.indexOf(stop) === i)
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

    // Naming neither bound leaves nothing of the layer's own to move through.
    if (!hasOwnStart && !hasOwnEnd) return null

    // A window that lies wholly to one side of the layer's single configured
    // bound would complete the open side past it, running the extent backwards
    // and sending a control into a span the layer holds no data for. The
    // layer names one instant there and the window names none, so the extent
    // closes on that instant: it stays reachable, and the open direction is
    // inert rather than pointing somewhere the layer never had data.
    if (!hasOwnStart && start > end) return { kind: 'periodic', start: end, end }
    if (!hasOwnEnd && end < start) return { kind: 'periodic', start, end: start }

    return { kind: 'periodic', start, end }
}

/**
 * A sparse layer's half of `navigateLayer`: data sits only on its stops, so
 * moving lands on the nearest stop the other side of the current time,
 * however far away it is — one press reaches a layer whose data sits months
 * from where the timeline is. Stepping is strict about the current instant,
 * so a press from an instant already sitting on a stop moves off it rather
 * than stalling there. Jumping to an outermost stop the current time already
 * sits on is nowhere to go either, for the reason `navigateLayer` documents.
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
            // Scanned from the far end rather than filtered: the answer is the
            // first stop the scan meets, and a row asks on every frame of a
            // drag, for a layer that can list a stop a day over years.
            for (let i = stops.length - 1; i >= 0; i--)
                if (stops[i].getTime() < at) return stops[i]
            return null
    }
}

/**
 * A periodic layer's half of `navigateLayer`: data runs throughout the
 * extent, so moving inside it steps by the timeline's own granularity — the
 * same step the global buttons take — and stops short at the extent's edge
 * rather than stepping past the data. One press from outside the extent
 * reaches its near edge, so a layer whose data lies well away from the
 * current time is one press away too. Jumping to an edge the current time
 * already sits on is nowhere to go either, for the reason `navigateLayer`
 * documents.
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
 * disabled.
 *
 * Dispatches to `navigateSparseLayer` or `navigatePeriodicLayer` by
 * `nav.kind`; see those for how each model moves. `mode` is read only by the
 * periodic side, which steps by the timeline's own granularity — a sparse
 * layer moves between its own stops regardless of mode.
 *
 * Jumping to an outermost instant the current time already sits on is nowhere
 * to go. That instant is where the previous press left the timeline, so
 * repeating it would re-commit the time already held while the control went on
 * looking live; null instead draws it inert, and leaves every control's inert
 * rule the one question of whether this function returns an instant.
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
