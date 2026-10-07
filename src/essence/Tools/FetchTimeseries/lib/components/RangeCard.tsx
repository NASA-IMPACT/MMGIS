import React, { useId } from 'react'
import { DateSelector } from '../../../Timeline/lib'

export type RangeStatus =
    | { kind: 'idle' }
    /** `page` and `pages` appear once the answer turns out to be paged. */
    | { kind: 'loading'; page?: number; pages?: number | null }
    | { kind: 'error'; message: string }

export interface RangeCardProps {
    /** ISO instants, YYYY-MM-DDTHH:MM:SS, read as UTC. */
    start: string
    end: string
    status: RangeStatus
    onRangeChange: (start: string, end: string) => void
    /** Closes this card and the chart it feeds. */
    onExit: () => void
}

/** The earliest instant Start can be set to. */
const MIN_INSTANT = '1000-01-01T00:00:00'

const toDate = (instant: string) => new Date(`${instant}Z`)

/** The picker works to the minute; the range is held to the second so
 *  `{start}`/`{end}` expand the same way. A picked End covers its whole
 *  minute, so a day picked as End still reaches 23:59:59. */
const toInstant = (date: Date, edge: 'start' | 'end') =>
    `${date.toISOString().slice(0, 16)}:${edge === 'end' ? '59' : '00'}`

/** The last second of the current UTC day: End's ceiling, unless the range
 *  already reaches past it. */
const endOfToday = () => {
    const now = new Date()
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
    )
}

function RangeField({
    label,
    value,
    min,
    max,
    onPick,
}: {
    label: string
    value: string
    min: Date
    max: Date
    onPick: (date: Date) => void
}) {
    const labelId = useId()
    return (
        <div className="range-card__field" role="group" aria-labelledby={labelId}>
            <span className="range-card__label" id={labelId}>
                {label}
            </span>
            {value ? (
                <DateSelector
                    className="range-card__date"
                    selectedDate={toDate(value)}
                    startTime={min}
                    endTime={max}
                    timeMode="HOUR"
                    onDateChange={onPick}
                />
            ) : (
                <span className="range-card__date range-card__date--empty">—</span>
            )}
        </div>
    )
}

/** Start and End pickers over a status line. Props only; the tool owns the
 *  state and the fetch. Each picker is bounded by the other, so the range
 *  can never be reversed. The chart below names the feature; this card does
 *  not repeat it. Values are UTC, hence the labels. */
export function RangeCard({
    start,
    end,
    status,
    onRangeChange,
    onExit,
}: RangeCardProps) {
    const startDate = start ? toDate(start) : null
    const endDate = end ? toDate(end) : null
    const today = endOfToday()
    const ceiling = endDate && endDate > today ? endDate : today

    return (
        <div className="range-card">
            <header className="range-card__header">
                <span className="range-card__heading">Timeseries</span>
                <button type="button" className="range-card__exit" onClick={onExit}>
                    EXIT
                </button>
            </header>
            <div className="range-card__fields">
                <RangeField
                    label="Start (UTC)"
                    value={start}
                    min={toDate(MIN_INSTANT)}
                    max={endDate ?? ceiling}
                    onPick={(date) => onRangeChange(toInstant(date, 'start'), end)}
                />
                <RangeField
                    label="End (UTC)"
                    value={end}
                    min={startDate ?? toDate(MIN_INSTANT)}
                    max={ceiling}
                    onPick={(date) => onRangeChange(start, toInstant(date, 'end'))}
                />
            </div>
            {status.kind === 'loading' && (
                <div className="range-card__status" aria-live="polite">
                    <span className="range-card__spinner" aria-hidden="true" />
                    Fetching data…
                    {status.page != null &&
                        ` page ${status.page}${status.pages ? ` of ${status.pages}` : ''}`}
                </div>
            )}
            {status.kind === 'error' && (
                <p className="range-card__error" role="alert">
                    {status.message}
                </p>
            )}
        </div>
    )
}
