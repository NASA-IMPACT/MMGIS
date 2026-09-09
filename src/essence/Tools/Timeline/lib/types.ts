import type { LayerNavigation } from './utils/layerNavigation'

export type TimeMode = 'YEAR' | 'MONTH' | 'DAY' | 'HOUR'

// Canonical display order, largest granularity first.
export const TIME_MODE_ORDER: TimeMode[] = ['YEAR', 'MONTH', 'DAY', 'HOUR']

export interface TimeRange {
    start: Date
    end: Date
    // Set when the span stands for a named period — a single day — so a
    // tooltip can say the day rather than spell out its first and last instant.
    label?: string
}

export interface LayerTimeData {
    name: string
    displayName: string
    timeRanges: TimeRange[]
    color: string
    // Where the layer's own row can put the current time. Absent when the
    // layer names no instant to move to, which is how a row goes without
    // navigation controls.
    navigation?: LayerNavigation | null
}
