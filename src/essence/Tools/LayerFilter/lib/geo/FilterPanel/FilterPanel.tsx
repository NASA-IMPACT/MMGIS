import React, { useEffect, useRef, useState } from 'react'
import type {
    ThemeDef,
    FilterSelections,
    FilterDef,
    GeocodeSelection,
} from '../../types'
import type { FacetOption } from '../../engine/types'
import type { EntryDisplay } from '../../utils/entryDisplay'
import { useDebouncedGeocode } from '../../hooks/useDebouncedGeocode'

export interface FilterPanelProps {
    /** The active theme (step 2 content), or null until one is selected. */
    theme: ThemeDef | null
    /** Current selections for the active theme, keyed by filter id. */
    selections: FilterSelections
    /** Engine-derived options (value + count) per filter id. */
    optionsByFilter?: Record<string, FacetOption[]>
    /** Presentation data for catalogue entries (isEntry pickers). */
    entriesById?: Record<string, EntryDisplay>
    /** External geocoder base URL; absent hides 'geocode' filters. */
    geocoderUrl?: string
    onChange: (
        filterId: string,
        value: string | string[] | GeocodeSelection | null,
    ) => void
}

function toArray(value: FilterSelections[string] | undefined): string[] {
    if (value == null || value === '') return []
    if (Array.isArray(value)) return value
    return typeof value === 'string' ? [value] : []
}

/**
 * Shared dropdown shell (per the designs — native selects can't render count
 * badges or chips): a select-styled trigger and an anchored menu, closed on
 * outside click.
 */
function Dropdown({
    trigger,
    children,
    open,
    setOpen,
}: {
    trigger: React.ReactNode
    children: React.ReactNode
    open: boolean
    setOpen: (open: boolean) => void
}) {
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const onDocClick = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [open, setOpen])

    return (
        <div ref={rootRef} className="blocks-layer-filter__dropdown">
            <button
                type="button"
                className="blocks-layer-filter__select blocks-layer-filter__dropdown-trigger"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                {trigger}
            </button>
            {open && (
                <div className="blocks-layer-filter__dropdown-menu" role="listbox">
                    {children}
                </div>
            )}
        </div>
    )
}

function Badge({ children }: { children: React.ReactNode }) {
    return <span className="blocks-layer-filter__badge">{children}</span>
}

/** Single- or multi-select enumerated filter as a badge-carrying dropdown. */
function EnumeratedField({
    filter,
    options,
    selected,
    onChange,
}: {
    filter: FilterDef
    options: FacetOption[]
    selected: string[]
    onChange: FilterPanelProps['onChange']
}) {
    const [open, setOpen] = useState(false)
    const multi = filter.multi === true
    const selectedOption = options.find((o) => selected.includes(o.value))

    const trigger =
        selected.length === 0 ? (
            <span className="blocks-layer-filter__trigger-label">
                {filter.allLabel ?? 'All'}
            </span>
        ) : (
            <span className="blocks-layer-filter__trigger-label">
                {multi ? selected.join(', ') : selected[0]}
                <Badge>
                    {multi ? selected.length : selectedOption?.count ?? 0}
                </Badge>
            </span>
        )

    return (
        <div className="blocks-layer-filter__field">
            <span className="blocks-layer-filter__label">{filter.label}</span>
            <Dropdown trigger={trigger} open={open} setOpen={setOpen}>
                {!multi && (
                    <button
                        type="button"
                        className="blocks-layer-filter__row"
                        onClick={() => {
                            onChange(filter.id, '')
                            setOpen(false)
                        }}
                    >
                        <span>{filter.allLabel ?? 'All'}</span>
                        {selected.length === 0 && (
                            <span className="blocks-layer-filter__check">✓</span>
                        )}
                    </button>
                )}
                {options.map((opt) => {
                    const isSelected = selected.includes(opt.value)
                    if (multi) {
                        const toggle = () => {
                            const next = isSelected
                                ? selected.filter((v) => v !== opt.value)
                                : [...selected, opt.value]
                            onChange(filter.id, next)
                        }
                        return (
                            <label
                                key={opt.value}
                                className="blocks-layer-filter__option"
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={toggle}
                                />
                                <span>{opt.value}</span>
                                <Badge>{opt.count}</Badge>
                            </label>
                        )
                    }
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            className="blocks-layer-filter__row"
                            onClick={() => {
                                onChange(filter.id, opt.value)
                                setOpen(false)
                            }}
                        >
                            <span>{opt.value}</span>
                            <Badge>{opt.count}</Badge>
                            {isSelected && (
                                <span className="blocks-layer-filter__check">✓</span>
                            )}
                        </button>
                    )
                })}
            </Dropdown>
        </div>
    )
}

/** The pick-one-entry control: count line, year-chip rows, selected meta. */
function EntryField({
    filter,
    options,
    selected,
    entriesById,
    onChange,
}: {
    filter: FilterDef
    options: FacetOption[]
    selected: string
    entriesById?: Record<string, EntryDisplay>
    onChange: FilterPanelProps['onChange']
}) {
    const [open, setOpen] = useState(false)
    const selectedEntry = selected !== '' ? entriesById?.[selected] : undefined

    const trigger = selectedEntry ? (
        <span className="blocks-layer-filter__trigger-label">
            <span className="blocks-layer-filter__year-chip">
                {selectedEntry.yearBadge}
            </span>
            {selectedEntry.title}
        </span>
    ) : (
        <span className="blocks-layer-filter__trigger-label">
            {filter.allLabel ?? 'Select…'}
        </span>
    )

    return (
        <div className="blocks-layer-filter__field">
            <div className="blocks-layer-filter__countline">
                <strong>{options.length}</strong>{' '}
                {filter.countLabel ?? filter.label ?? 'entries'}
            </div>
            <Dropdown trigger={trigger} open={open} setOpen={setOpen}>
                {options.map((opt) => {
                    const entry = entriesById?.[opt.value]
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            className="blocks-layer-filter__row"
                            onClick={() => {
                                onChange(filter.id, opt.value)
                                setOpen(false)
                            }}
                        >
                            {entry?.yearBadge && (
                                <span className="blocks-layer-filter__year-chip">
                                    {entry.yearBadge}
                                </span>
                            )}
                            <span>{entry?.title ?? opt.value}</span>
                            {selected === opt.value && (
                                <span className="blocks-layer-filter__check">✓</span>
                            )}
                        </button>
                    )
                })}
            </Dropdown>
            {selectedEntry && selectedEntry.dateRange && (
                <div className="blocks-layer-filter__entry-meta">
                    <span className="blocks-layer-filter__entry-dates">
                        {selectedEntry.dateRange}
                    </span>
                    {selectedEntry.isActive && (
                        <span className="blocks-layer-filter__pill">ACTIVE</span>
                    )}
                </div>
            )}
        </div>
    )
}

function GeocodeField({
    filter,
    selection,
    geocoderUrl,
    onChange,
}: {
    filter: FilterDef
    selection: GeocodeSelection | null
    geocoderUrl: string
    onChange: FilterPanelProps['onChange']
}) {
    const [query, setQuery] = useState('')
    const { results, loading } = useDebouncedGeocode(
        geocoderUrl,
        selection ? '' : query,
    )

    if (selection) {
        return (
            <div className="blocks-layer-filter__field">
                <span className="blocks-layer-filter__label">{filter.label}</span>
                <div className="blocks-layer-filter__chip">
                    <span className="blocks-layer-filter__chip-label">
                        {selection.label}
                    </span>
                    <button
                        type="button"
                        className="blocks-layer-filter__chip-clear"
                        aria-label={`Clear ${filter.label ?? 'location'}`}
                        onClick={() => {
                            setQuery('')
                            onChange(filter.id, null)
                        }}
                    >
                        ×
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="blocks-layer-filter__field">
            <span className="blocks-layer-filter__label">{filter.label}</span>
            <input
                className="blocks-layer-filter__select"
                type="search"
                placeholder={filter.allLabel ?? 'Search places…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            {loading && (
                <div className="blocks-layer-filter__hint">Searching…</div>
            )}
            {!loading && results.length > 0 && (
                <ul className="blocks-layer-filter__results" role="listbox">
                    {results.map((r) => (
                        <li key={r.id}>
                            <button
                                type="button"
                                className="blocks-layer-filter__result"
                                onClick={() => {
                                    setQuery('')
                                    onChange(filter.id, {
                                        label: r.label,
                                        geometry: r.geometry,
                                    })
                                }}
                            >
                                {r.label}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/** Presentational step-2 panel: theme heading + its configured filters. */
export function FilterPanel({
    theme,
    selections,
    optionsByFilter,
    entriesById,
    geocoderUrl,
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
                const raw = selections[filter.id]

                if (filter.type === 'geocode') {
                    if (!geocoderUrl) return null
                    const selection =
                        raw != null && typeof raw === 'object' && !Array.isArray(raw)
                            ? (raw as GeocodeSelection)
                            : null
                    return (
                        <GeocodeField
                            key={filter.id}
                            filter={filter}
                            selection={selection}
                            geocoderUrl={geocoderUrl}
                            onChange={onChange}
                        />
                    )
                }

                if (filter.isEntry === true) {
                    return (
                        <EntryField
                            key={filter.id}
                            filter={filter}
                            options={options}
                            selected={typeof raw === 'string' ? raw : ''}
                            entriesById={entriesById}
                            onChange={onChange}
                        />
                    )
                }

                return (
                    <EnumeratedField
                        key={filter.id}
                        filter={filter}
                        options={options}
                        selected={toArray(raw)}
                        onChange={onChange}
                    />
                )
            })}
        </div>
    )
}
