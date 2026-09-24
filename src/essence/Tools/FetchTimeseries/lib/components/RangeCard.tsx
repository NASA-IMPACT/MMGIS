import React from 'react'

export type RangeStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }

export interface RangeCardProps {
    /** ISO dates, YYYY-MM-DD. */
    start: string
    end: string
    status: RangeStatus
    onRangeChange: (start: string, end: string) => void
    /** Closes this card and the chart it feeds. */
    onExit: () => void
}

/** Start and End date inputs over a status line. Props only; the tool owns
 *  the state and the fetch. Each input is bounded by the other, so the range
 *  can never be reversed. The chart below names the feature; this card
 *  does not repeat it. */
export function RangeCard({
    start,
    end,
    status,
    onRangeChange,
    onExit,
}: RangeCardProps) {
    return (
        <div className="range-card">
            <header className="range-card__header">
                <span className="range-card__heading">Timeseries</span>
                <button type="button" className="range-card__exit" onClick={onExit}>
                    EXIT
                </button>
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
