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

    const start = moment(startTime)
    const end = moment(endTime)
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
 * Format date based on time mode
 */
export function formatDateByMode(date: Date, mode: TimeMode): string {
    const m = moment(date)
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
 * Calculate zoom extents for the timeline
 */
export function calculateZoomExtent(
    totalDuration: number,
    mode: TimeMode
): [number, number] {
    // Minimum zoom shows at least 2 units
    // Maximum zoom shows the entire range
    const minUnits = 2
    const maxUnits = Math.ceil(totalDuration / getMillisecondsPerUnit(mode))

    return [1, Math.max(maxUnits / minUnits, 1)]
}

function getMillisecondsPerUnit(mode: TimeMode): number {
    switch (mode) {
        case 'YEAR':
            return 365 * 24 * 60 * 60 * 1000 // Approximate
        case 'MONTH':
            return 30 * 24 * 60 * 60 * 1000 // Approximate
        case 'DAY':
            return 24 * 60 * 60 * 1000
        case 'HOUR':
            return 60 * 60 * 1000
    }
}

/**
 * Clamp a date to be within a range
 */
export function clampDate(date: Date, min: Date, max: Date): Date {
    if (date < min) return min
    if (date > max) return max
    return date
}
