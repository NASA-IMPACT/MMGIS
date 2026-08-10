export type TimeMode = 'YEAR' | 'MONTH' | 'DAY' | 'HOUR'

// Canonical display order, largest granularity first.
export const TIME_MODE_ORDER: TimeMode[] = ['YEAR', 'MONTH', 'DAY', 'HOUR']

export interface TimeRange {
    start: Date
    end: Date
}

export interface LayerTimeData {
    name: string
    displayName: string
    timeRanges: TimeRange[]
    color: string
}
