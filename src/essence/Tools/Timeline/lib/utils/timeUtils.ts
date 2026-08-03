import moment from 'moment'
import type { TimeMode } from '../types'

/**
 * Calculate the appropriate time step based on the time mode
 */
export function getTimeStep(mode: TimeMode): {
    unit: moment.unitOfTime.DurationConstructor
    value: number
} {
    switch (mode) {
        case 'YEAR':
            return { unit: 'years', value: 1 }
        case 'MONTH':
            return { unit: 'months', value: 1 }
        case 'DAY':
            return { unit: 'days', value: 1 }
        case 'HOUR':
            return { unit: 'hours', value: 1 }
    }
}

/**
 * Generate time ticks for the timeline axis
 */
export function generateTimeTicks(
    startTime: Date,
    endTime: Date,
    mode: TimeMode,
    maxTicks: number = 100
): Date[] {
    const ticks: Date[] = []
    const { unit, value } = getTimeStep(mode)

    // The whole plugin reads and writes UTC, so ticks snap to UTC unit
    // boundaries. Local snapping would offset every label from the date it
    // carries by the viewer's UTC offset.
    const start = moment.utc(startTime)
    const end = moment.utc(endTime)
    if (!end.isAfter(start)) return [startTime]

    // Snapping to the unit boundary can land before the domain; step forward
    // until the first tick is inside it so the axis never renders a label for
    // an instant left of startTime.
    let current = start.clone().startOf(unit as moment.unitOfTime.StartOf)

    const totalSteps = end.diff(current, unit as moment.unitOfTime.Diff) / value
    let stepMultiplier = 1
    if (totalSteps > maxTicks) {
        stepMultiplier = Math.ceil(totalSteps / maxTicks)

        // Round the multiplier to a readable interval
        if (unit === 'hours') {
            if (stepMultiplier <= 2) stepMultiplier = 2
            else if (stepMultiplier <= 3) stepMultiplier = 3
            else if (stepMultiplier <= 6) stepMultiplier = 6
            else if (stepMultiplier <= 12) stepMultiplier = 12
            else stepMultiplier = Math.ceil(stepMultiplier / 24) * 24
        } else if (unit === 'days') {
            if (stepMultiplier <= 2) stepMultiplier = 2
            else if (stepMultiplier <= 7) stepMultiplier = 7
            else if (stepMultiplier <= 14) stepMultiplier = 14
            else stepMultiplier = Math.ceil(stepMultiplier / 30) * 30
        }
    }

    const step = value * stepMultiplier
    while (current.isBefore(start)) {
        current = current.add(step, unit)
    }

    let count = 0
    while (current.isBefore(end) && count < maxTicks) {
        ticks.push(current.toDate())
        current = current.clone().add(step, unit)
        count++
    }

    // Close the axis on the domain's end, unless a tick already sits there.
    const last = ticks[ticks.length - 1]
    if (!last || last.getTime() !== endTime.getTime()) {
        ticks.push(endTime)
    }

    return ticks
}

/**
 * Format date based on time mode. UTC, matching the header, the layer bar
 * tooltips and the scrubber's accessible value.
 */
export function formatDateByMode(date: Date, mode: TimeMode): string {
    const m = moment.utc(date)
    switch (mode) {
        case 'YEAR':
            return m.format('YYYY')
        case 'MONTH':
            return m.format('MMM YYYY')
        case 'DAY':
            return m.format('MMM D')
        case 'HOUR':
            return m.format('HH:mm')
    }
}

/**
 * Move an instant by whole time-mode units, in UTC. Local calendar arithmetic
 * would make a step across the viewer's daylight-saving boundary 23 or 25
 * hours long, drifting the displayed UTC clock by an hour each time.
 */
export function stepTime(date: Date, mode: TimeMode, steps: number): Date {
    const { unit, value } = getTimeStep(mode)
    return moment
        .utc(date)
        .add(steps * value, unit)
        .toDate()
}

/**
 * Clamp a date to be within a range
 */
export function clampDate(date: Date, min: Date, max: Date): Date {
    if (date < min) return min
    if (date > max) return max
    return date
}
