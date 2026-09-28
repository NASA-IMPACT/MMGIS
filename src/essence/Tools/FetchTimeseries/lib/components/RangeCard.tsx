import React from 'react'

export type RangeStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }

export interface RangeCardProps {
    /** ISO instants, YYYY-MM-DDTHH:MM:SS, read as UTC. */
    start: string
    end: string
    /** False when the layer's URL has no {start}/{end}: no inputs to show. */
    hasRange: boolean
    status: RangeStatus
    onRangeChange: (start: string, end: string) => void
    /** Closes this card and the chart it feeds. */
    onExit: () => void
}

/** A datetime-local input drops zero seconds (`…T12:00`); the range is
 *  always held to the second so `{start}`/`{end}` expand the same way. */
const toSeconds = (value: string) =>
    value.length === 16 ? `${value}:00` : value

/** Start and End inputs over a status line. Props only; the tool owns the
 *  state and the fetch. Each input is bounded by the other, so the range can
 *  never be reversed. The chart below names the feature; this card does not
 *  repeat it. */
export function RangeCard({
    start,
    end,
    hasRange,
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
            {hasRange && (
                <div className="range-card__fields">
                    <label className="range-card__field">
                        <span className="range-card__label">Start</span>
                        <input
                            type="datetime-local"
                            step={1}
                            className="range-card__input"
                            value={start}
                            max={end}
                            onChange={(e) => {
                                const next = toSeconds(e.target.value)
                                if (next) onRangeChange(next, next > end ? next : end)
                            }}
                        />
                    </label>
                    <label className="range-card__field">
                        <span className="range-card__label">End</span>
                        <input
                            type="datetime-local"
                            step={1}
                            className="range-card__input"
                            value={end}
                            min={start}
                            onChange={(e) => {
                                const next = toSeconds(e.target.value)
                                if (next) onRangeChange(next < start ? next : start, next)
                            }}
                        />
                    </label>
                </div>
            )}
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
