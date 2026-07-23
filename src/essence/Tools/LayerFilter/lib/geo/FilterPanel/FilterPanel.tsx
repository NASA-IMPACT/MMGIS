import React from 'react'
import type { ThemeDef, FilterSelections } from '../../types'
import type { FacetOption } from '../../engine/types'
import type { EntryDisplay } from '../../utils/entryDisplay'

export interface FilterPanelProps {
    /** The active theme (step 2 content), or null until one is selected. */
    theme: ThemeDef | null
    /** Current selections for the active theme, keyed by filter id. */
    selections: FilterSelections
    /** Engine-derived options (value + count) per filter id. */
    optionsByFilter?: Record<string, FacetOption[]>
    /** Presentation data for catalogue entries (isEntry pickers). */
    entriesById?: Record<string, EntryDisplay>
    onChange: (filterId: string, value: string | string[]) => void
}

function toArray(value: string | string[] | undefined): string[] {
    if (value == null || value === '') return []
    return Array.isArray(value) ? value : [value]
}

/** Presentational step-2 panel: theme heading + its configured filters. */
export function FilterPanel({
    theme,
    selections,
    optionsByFilter,
    entriesById,
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
                const options = optionsByFilter?.[filter.id] ?? []

                if (filter.multi === true) {
                    const selected = toArray(selections[filter.id])
                    const toggle = (value: string) => {
                        const next = selected.includes(value)
                            ? selected.filter((v) => v !== value)
                            : [...selected, value]
                        onChange(filter.id, next)
                    }
                    return (
                        <fieldset key={filter.id} className="blocks-layer-filter__field">
                            <legend className="blocks-layer-filter__label">
                                {filter.label}
                                {selected.length > 0 && (
                                    <span className="blocks-layer-filter__badge">
                                        {selected.length}
                                    </span>
                                )}
                            </legend>
                            {options.map((opt) => (
                                <label
                                    key={opt.value}
                                    className="blocks-layer-filter__option"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(opt.value)}
                                        onChange={() => toggle(opt.value)}
                                    />
                                    <span>{opt.value}</span>
                                    <span className="blocks-layer-filter__count">
                                        {opt.count}
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    )
                }

                const value = selections[filter.id]

                if (filter.isEntry === true) {
                    const selectedEntry =
                        typeof value === 'string' && value !== ''
                            ? entriesById?.[value]
                            : undefined
                    return (
                        <div key={filter.id} className="blocks-layer-filter__field">
                            <div className="blocks-layer-filter__countline">
                                <strong>{options.length}</strong>{' '}
                                {filter.countLabel ?? filter.label ?? 'entries'}
                            </div>
                            <select
                                className="blocks-layer-filter__select"
                                value={typeof value === 'string' ? value : ''}
                                onChange={(e) => onChange(filter.id, e.target.value)}
                            >
                                <option value="">
                                    {filter.allLabel ?? 'Select…'}
                                </option>
                                {options.map((opt) => {
                                    const entry = entriesById?.[opt.value]
                                    const label = entry
                                        ? `${entry.yearBadge}  ${entry.title}`
                                        : opt.value
                                    return (
                                        <option key={opt.value} value={opt.value}>
                                            {label}
                                        </option>
                                    )
                                })}
                            </select>
                            {selectedEntry && selectedEntry.dateRange && (
                                <div className="blocks-layer-filter__entry-meta">
                                    <span className="blocks-layer-filter__entry-dates">
                                        {selectedEntry.dateRange}
                                    </span>
                                    {selectedEntry.isActive && (
                                        <span className="blocks-layer-filter__pill">
                                            ACTIVE
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                }

                return (
                    <label key={filter.id} className="blocks-layer-filter__field">
                        <span className="blocks-layer-filter__label">{filter.label}</span>
                        <select
                            className="blocks-layer-filter__select"
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) => onChange(filter.id, e.target.value)}
                        >
                            <option value="">{filter.allLabel ?? 'All'}</option>
                            {options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.value} ({opt.count})
                                </option>
                            ))}
                        </select>
                    </label>
                )
            })}
        </div>
    )
}
