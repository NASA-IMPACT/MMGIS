import React from 'react'
import type { GeocodeResult } from '../../types'

export type SearchPanelProps = {
    query: string
    results: GeocodeResult[]
    loading: boolean
    onQueryChange: (query: string) => void
    onSelect: (result: GeocodeResult) => void
}

export function SearchPanel({ query, results, loading, onQueryChange, onSelect }: SearchPanelProps) {
    // Presentational only: the surface hosting the panel places focus, which on
    // open lands on the query field as the first focusable control here.
    return (
        <div className="blocks-search-panel">
            <div className="blocks-search-panel__row">
                <input
                    type="search"
                    className="blocks-search-panel__input"
                    placeholder="Search location…"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                />
            </div>
            {loading && <div className="blocks-search-panel__hint">Searching…</div>}
            {!loading && query.length >= 2 && results.length === 0 && (
                <div className="blocks-search-panel__hint">No results</div>
            )}
            {results.map((r) => (
                <button
                    key={r.id}
                    type="button"
                    className="blocks-search-panel__result"
                    onClick={() => onSelect(r)}
                >
                    <span className="blocks-search-panel__label">{r.displayName}</span>
                </button>
            ))}
        </div>
    )
}
