import React from 'react'
import type { ThemeDef, FilterSelections, FilterOption } from '../../types'

export interface FilterPanelProps {
    /** The active theme (step 2 content), or null until one is selected. */
    theme: ThemeDef | null
    /** Current selections for the active theme: filter id -> value ("" = all). */
    selections: FilterSelections
    /** Resolved options per filter id (derived from data/time, or config). */
    optionsByFilter?: Record<string, FilterOption[]>
    onChange: (filterId: string, value: string) => void
}

/** Presentational step-2 panel: theme heading + its configured filters. */
export function FilterPanel({
    theme,
    selections,
    optionsByFilter,
    onChange,
}: FilterPanelProps) {
    if (!theme) return null

    return (
        <div className="blocks-layer-filter">
            <h2 className="blocks-layer-filter__title">{theme.title}</h2>
            {theme.description && (
                <p className="blocks-layer-filter__description">{theme.description}</p>
            )}

            {theme.filters.map((filter) => {
                const options = optionsByFilter?.[filter.id] ?? filter.options ?? []
                return (
                    <label key={filter.id} className="blocks-layer-filter__field">
                        <span className="blocks-layer-filter__label">{filter.label}</span>
                        <select
                            className="blocks-layer-filter__select"
                            value={selections[filter.id] ?? ''}
                            onChange={(e) => onChange(filter.id, e.target.value)}
                        >
                            <option value="">{filter.allLabel ?? 'All'}</option>
                            {options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )
            })}
        </div>
    )
}
