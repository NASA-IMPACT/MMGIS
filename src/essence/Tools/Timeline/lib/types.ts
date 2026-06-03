export type TimeMode = 'MONTH' | 'DAY' | 'HOUR'

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
