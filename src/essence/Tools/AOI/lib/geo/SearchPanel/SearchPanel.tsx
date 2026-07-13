import React, { useEffect, useRef } from 'react'
import { TextInput } from '@trussworks/react-uswds'
import type { AOISearchResult } from '../../types'

export type SearchPanelProps = {
    query: string
    results: AOISearchResult[]
    disabled?: boolean
    loading?: boolean
    onQueryChange: (q: string) => void
    onSelect: (id: string) => void
}

export function SearchPanel({
    query,
    results,
    disabled,
    loading,
    onQueryChange,
    onSelect,
}: SearchPanelProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const inputDisabled = disabled || loading

    return (
        <div className="blocks-aoi-panel blocks-aoi-panel--search">
            <p className="blocks-aoi-panel__hint">Search for a country or a region</p>
            <label className="blocks-aoi-search">
                <TextInput
                    id="aoi-search-input"
                    name="aoi-search"
                    type="search"
                    inputRef={inputRef}
                    className="blocks-aoi-search__input"
                    placeholder={loading ? 'Loading boundaries…' : 'Search'}
                    value={query}
                    disabled={inputDisabled}
                    onChange={(e) => onQueryChange(e.target.value)}
                />
                <i className="mdi mdi-magnify blocks-aoi-search__icon" aria-hidden="true" />
            </label>

            {loading && <p className="blocks-aoi-panel__empty">Loading boundary data…</p>}

            {!loading && disabled && (
                <p className="blocks-aoi-panel__empty">
                    No boundary data is available for this mission.
                </p>
            )}

            {!inputDisabled && results.length > 0 && (
                <ul className="blocks-aoi-search__results" role="listbox">
                    {results.map((r) => (
                        <li key={r.id}>
                            <button
                                type="button"
                                className="blocks-aoi-search__result"
                                onClick={() => onSelect(r.id)}
                            >
                                <span className="blocks-aoi-search__result-label">{r.label}</span>
                                <span className="blocks-aoi-search__result-kind">{r.kind}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
