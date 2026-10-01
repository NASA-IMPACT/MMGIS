import React from 'react'

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

/** A datetime-local input drops zero seconds (`…T12:00`); the range is
 *  always held to the second so `{start}`/`{end}` expand the same way. */
const toSeconds = (value: string) =>
    value.length === 16 ? `${value}:00` : value

/** Chrome fires change for every partial year typed (0002-…, 0020-…,
 *  0202-…); those would drag the other bound back to year 2. */
const MIN_INSTANT = '1000-01-01T00:00:00'
const isComplete = (value: string) => value >= MIN_INSTANT

/** Start and End inputs over a status line. Props only; the tool owns the
 *  state and the fetch. A value is reported as typed; only leaving a field
 *  with the range reversed snaps the other bound to it, since a change
 *  event fires for every partial day typed ("2" on the way to "25"). The
 *  chart below names the feature; this card does not repeat it. */
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
                    <span className="range-card__label">Start</span>
                    <input
                        type="datetime-local"
                        step={1}
                        className="range-card__input"
                        value={start}
                        min={MIN_INSTANT}
                        max={end}
                        onChange={(e) => {
                            const next = toSeconds(e.target.value)
                            if (isComplete(next)) onRangeChange(next, end)
                        }}
                        onBlur={() => {
                            if (start > end) onRangeChange(start, start)
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
                            if (isComplete(next)) onRangeChange(start, next)
                        }}
                        onBlur={() => {
                            if (end < start) onRangeChange(end, end)
                        }}
                    />
                </label>
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
