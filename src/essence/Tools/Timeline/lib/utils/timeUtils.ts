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

    let current = moment(startTime).startOf(unit as moment.unitOfTime.StartOf)
    const end = moment(endTime)

    const totalSteps = end.diff(current, unit as moment.unitOfTime.Diff) / value
    let stepMultiplier = 1
    if (totalSteps > maxTicks) {
        stepMultiplier = Math.ceil(totalSteps / maxTicks)
        
        // Make the multiplier "nice" (e.g. multiples of 2, 5, 10)
        if (unit === 'minutes' || unit === 'seconds') {
            if (stepMultiplier <= 2) stepMultiplier = 2
            else if (stepMultiplier <= 5) stepMultiplier = 5
            else if (stepMultiplier <= 10) stepMultiplier = 10
            else if (stepMultiplier <= 15) stepMultiplier = 15
            else if (stepMultiplier <= 30) stepMultiplier = 30
            else stepMultiplier = Math.ceil(stepMultiplier / 60) * 60
        } else if (unit === 'hours') {
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

    let count = 0
    while (current.isBefore(end) && count < maxTicks) {
        ticks.push(current.toDate())
        current = current.add(value * stepMultiplier, unit as moment.unitOfTime.DurationConstructor)
        count++
    }

    // Always add the end tick
    if (ticks.length === 0 || ticks[ticks.length - 1].getTime() !== endTime.getTime()) {
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
