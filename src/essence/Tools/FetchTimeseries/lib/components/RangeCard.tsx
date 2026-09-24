import React from 'react'

export type RangeStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }

export interface RangeCardProps {
    /** The selected feature's title; the card's heading once something is picked. */
    title?: string
    /** The layer's display name, under the title. */
    subtitle?: string
    /** ISO dates, YYYY-MM-DD. */
    start: string
    end: string
    status: RangeStatus
    onRangeChange: (start: string, end: string) => void
}

/** Start and End date inputs over a status line. Props only; the tool owns
 *  the state and the fetch. Each input is bounded by the other, so the range
 *  can never be reversed. */
export function RangeCard({
    title,
    subtitle,
    start,
    end,
    status,
    onRangeChange,
}: RangeCardProps) {
    return (
        <div className="range-card">
            <header className="range-card__header">
                <h3 className="range-card__title" title={title}>
                    {title ?? 'Timeseries'}
                </h3>
                {subtitle && <p className="range-card__subtitle">{subtitle}</p>}
            </header>
            <div className="range-card__fields">
                <label className="range-card__field">
                    <span className="range-card__label">Start date</span>
                    <input
                        type="date"
                        className="range-card__input"
                        value={start}
                        max={end}
                        onChange={(e) => {
                            const next = e.target.value
                            if (next) onRangeChange(next, next > end ? next : end)
                        }}
                    />
                </label>
                <label className="range-card__field">
                    <span className="range-card__label">End date</span>
                    <input
                        type="date"
                        className="range-card__input"
                        value={end}
                        min={start}
                        onChange={(e) => {
                            const next = e.target.value
                            if (next) onRangeChange(next < start ? next : start, next)
                        }}
                    />
                </label>
            </div>
            {status.kind === 'loading' && (
                <div className="range-card__status" aria-live="polite">
                    <span className="range-card__spinner" aria-hidden="true" />
                    Fetching data…
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
