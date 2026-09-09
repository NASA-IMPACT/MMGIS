import moment from 'moment'
import type { TimeMode } from '../types'
import { stepTime } from './timeUtils'
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
    /** Periodic extent, or the first and last stop of a sparse layer. */
    start: Date
    end: Date
}

/**
 * The navigation model for a layer, or null when there is nothing to navigate:
 * the layer is not time-enabled, or its configuration names no instant the
 * timeline could move to.
 *
 * The configuration is read exactly as the timeline reads it for drawing, so a
 * layer that draws one box gets one stop. Listed days must be written as ISO
 * 8601, give or take the whitespace a comma-separated list picks up; unreadable
 * ones are dropped rather than guessed at, and a list with nothing readable in
 * it leaves the layer navigating its extent instead. The extent either side is
 * read leniently, since configs carry values in looser formats.
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
    time: LayerTimeConfig | undefined
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

    const start = time.dataStartTime ? new Date(time.dataStartTime) : null
    const end =
        time.dataEndTime === 'now'
            ? new Date()
            : time.dataEndTime
              ? new Date(time.dataEndTime)
              : null

    // Without both bounds there is no extent to move through.
    if (!start || isNaN(start.getTime())) return null
    if (!end || isNaN(end.getTime())) return null

    return { kind: 'periodic', start, end }
}

/**
 * Where a layer's first/previous/next/last control puts the current time, or
 * null when that control has nowhere to go — the signal a layer row draws it
 * disabled.
 *
 * A sparse layer holds data only on its stops, so moving lands on the nearest
 * stop the other side of the current time, however far away it is: one press
 * reaches a layer whose data sits months from where the timeline is. Stepping
 * is strict about the current instant, so a press from an instant already
 * sitting on a stop moves off it rather than stalling there.
 *
 * A periodic layer holds data throughout its extent, so moving inside it steps
 * by the timeline's own granularity — the same step the global buttons take —
 * and stops short at the extent's edge rather than stepping past the data. One
 * press from outside the extent reaches its near edge, so a layer whose data
 * lies well away from the current time is one press away too.
 */
export function navigateLayer(
    nav: LayerNavigation,
    from: Date,
    action: 'first' | 'prev' | 'next' | 'last',
    mode: TimeMode
): Date | null {
    const at = from.getTime()

    if (nav.kind === 'sparse') {
        const stops = nav.stops ?? []
        if (stops.length === 0) return null

        switch (action) {
            case 'first':
                return stops[0]
            case 'last':
                return stops[stops.length - 1]
            case 'next':
                return stops.find((stop) => stop.getTime() > at) ?? null
            case 'prev':
                return stops.filter((stop) => stop.getTime() < at).pop() ?? null
        }
    }

    const start = nav.start.getTime()
    const end = nav.end.getTime()

    switch (action) {
        case 'first':
            return nav.start
        case 'last':
            return nav.end
        case 'next':
            if (at < start) return nav.start
            if (at >= end) return null
            return new Date(Math.min(stepTime(from, mode, 1).getTime(), end))
        case 'prev':
            if (at > end) return nav.end
            if (at <= start) return null
            return new Date(Math.max(stepTime(from, mode, -1).getTime(), start))
    }
}
