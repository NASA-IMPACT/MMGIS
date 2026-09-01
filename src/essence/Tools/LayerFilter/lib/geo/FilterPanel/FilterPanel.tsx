import React, { useLayoutEffect, useRef, useState } from 'react'
import type {
    ThemeDef,
    FilterSelections,
    FilterDef,
    GeocodeSelection,
} from '../../types'
import type { FacetOption } from '../../engine/types'
import type { EntryDisplay } from '../../utils/entryDisplay'
import { useDebouncedGeocode } from '../../hooks/useDebouncedGeocode'
import { FloatingPopover } from '../../FloatingPopover'

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

/** Whether a filter currently narrows the result set. */
function isActive(value: FilterSelections[string] | undefined): boolean {
    if (value == null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    return true
}

/** The value that means "no selection" for a given filter's control. */
function emptyValue(filter: FilterDef): string | string[] | null {
    if (filter.type === 'geocode') return null
    return filter.multi === true ? [] : ''
}

/** Sliders glyph marking the collapsible filter section. */
function FiltersIcon() {
    return (
        <svg
            className="blocks-layer-filter__filters-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
        >
            <g
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                fill="none"
            >
                <path d="M1 4h14M1 8h14M1 12h14" />
            </g>
            <g fill="currentColor">
                <circle cx="11" cy="4" r="2" />
                <circle cx="5" cy="8" r="2" />
                <circle cx="9" cy="12" r="2" />
            </g>
        </svg>
    )
}

/**
 * Shared dropdown shell (per the designs — native selects can't render count
 * badges or chips): a select-styled trigger and a menu floated over the page.
 *
 * The menu is portalled rather than absolutely positioned inside the field, so
 * it escapes the left panel's `overflow-y: auto` instead of being clipped or
 * extending the panel's scroll height.
 */
function Dropdown({
    trigger,
    children,
    label,
    open,
    setOpen,
}: {
    trigger: React.ReactNode
    children: React.ReactNode
    label?: string
    open: boolean
    setOpen: (open: boolean) => void
}) {
    const triggerRef = useRef<HTMLButtonElement>(null)
    // FloatingPopover centres the menu on its anchor; matching the trigger's
    // width is what makes it read as a select's menu, flush to both edges.
    const [menuWidth, setMenuWidth] = useState<number>()

    useLayoutEffect(() => {
        if (!open) return
        const measure = () => {
            const width = triggerRef.current?.getBoundingClientRect().width
            if (width) setMenuWidth(width)
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [open])

    return (
        <div className="blocks-layer-filter__dropdown">
            <button
                ref={triggerRef}
                type="button"
                className="blocks-layer-filter__select blocks-layer-filter__dropdown-trigger"
                aria-expanded={open}
                aria-haspopup="listbox"
                onClick={() => setOpen(!open)}
            >
                {trigger}
            </button>
            <FloatingPopover
                anchorRef={triggerRef}
                isOpen={open}
                onClose={() => setOpen(false)}
                placement="bottom"
                offset={2}
                label={label}
            >
                <div
                    className="blocks-layer-filter__dropdown-menu"
                    role="listbox"
                    style={menuWidth ? { width: menuWidth } : undefined}
                >
                    {children}
                </div>
            </FloatingPopover>
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

    const trigger =
        selected.length === 0 ? (
            <span className="blocks-layer-filter__trigger-label">
                {filter.allLabel ?? 'All'}
            </span>
        ) : (
            <span className="blocks-layer-filter__trigger-label">
                {multi ? selected.join(', ') : selected[0]}
                {multi && <Badge>{selected.length}</Badge>}
            </span>
        )

    return (
        <div className="blocks-layer-filter__field">
            <span className="blocks-layer-filter__label">{filter.label}</span>
            <Dropdown
                trigger={trigger}
                label={filter.label}
                open={open}
                setOpen={setOpen}
            >
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

/**
 * The pick-one-entry control, presented as the panel's results card: how many
 * entries survive the current filters, the picker itself, and the chosen
 * entry's dates.
 */
function EntryField({
    filter,
    options,
    selected,
    entriesById,
    onClear,
    showClear,
    onChange,
}: {
    filter: FilterDef
    options: FacetOption[]
    selected: string
    entriesById?: Record<string, EntryDisplay>
    onClear: () => void
    showClear: boolean
    onChange: FilterPanelProps['onChange']
}) {
    const [open, setOpen] = useState(false)
    const selectedEntry = selected !== '' ? entriesById?.[selected] : undefined
    const noun = filter.countLabel ?? filter.label ?? 'entries'

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
        <div className="blocks-layer-filter__results">
            <div className="blocks-layer-filter__results-label">
                Matching {noun}
            </div>
            <div className="blocks-layer-filter__countline">
                <span className="blocks-layer-filter__count">
                    {options.length}
                </span>
                <span>{noun} match</span>
                {showClear && (
                    <button
                        type="button"
                        className="blocks-layer-filter__clear"
                        onClick={onClear}
                    >
                        Clear filters
                    </button>
                )}
            </div>
            <Dropdown
                trigger={trigger}
                label={filter.label}
                open={open}
                setOpen={setOpen}
            >
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
                type="text"
                placeholder={filter.allLabel ?? 'Search places…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            {loading && (
                <div className="blocks-layer-filter__hint">Searching…</div>
            )}
            {!loading && results.length > 0 && (
                <ul className="blocks-layer-filter__results-list" role="listbox">
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
    const [filtersOpen, setFiltersOpen] = useState(true)

    if (!theme) return null

    // The entry picker is presented separately, as the results card below the
    // filters that produce it.
    const entryFilters = theme.filters.filter((f) => f.isEntry === true)
    const facetFilters = theme.filters.filter(
        (f) => f.isEntry !== true && (f.type !== 'geocode' || !!geocoderUrl),
    )
    const activeCount = facetFilters.filter((f) =>
        isActive(selections[f.id]),
    ).length
    const anyActive = theme.filters.some((f) => isActive(selections[f.id]))

    const clearAll = () => {
        for (const filter of theme.filters) {
            if (isActive(selections[filter.id])) {
                onChange(filter.id, emptyValue(filter))
            }
        }
    }

    const renderFacet = (filter: FilterDef) => {
        const options = optionsByFilter?.[filter.id] ?? []
        const raw = selections[filter.id]

        if (filter.type === 'geocode') {
            const selection =
                raw != null && typeof raw === 'object' && !Array.isArray(raw)
                    ? (raw as GeocodeSelection)
                    : null
            return (
                <GeocodeField
                    key={filter.id}
                    filter={filter}
                    selection={selection}
                    geocoderUrl={geocoderUrl as string}
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
    }

    return (
        <div className="blocks-layer-filter">
            <h2 className="blocks-layer-filter__title">{theme.title}</h2>
            {theme.description && (
                <p className="blocks-layer-filter__description">
                    {theme.description}
                </p>
            )}

            {facetFilters.length > 0 && (
                <div className="blocks-layer-filter__filters">
                    <button
                        type="button"
                        className="blocks-layer-filter__filters-header"
                        aria-expanded={filtersOpen}
                        onClick={() => setFiltersOpen(!filtersOpen)}
                    >
                        <FiltersIcon />
                        <span>Filters</span>
                        {activeCount > 0 && (
                            <span className="blocks-layer-filter__filters-count">
                                {activeCount}
                            </span>
                        )}
                        <span
                            className={`blocks-layer-filter__chevron${
                                filtersOpen
                                    ? ''
                                    : ' blocks-layer-filter__chevron--collapsed'
                            }`}
                            aria-hidden="true"
                        />
                    </button>
                    {filtersOpen && (
                        <div className="blocks-layer-filter__filters-body">
                            {facetFilters.map(renderFacet)}
                            {/* Without an entry picker there's no results card
                                to host the reset, so it lives with the filters. */}
                            {entryFilters.length === 0 && anyActive && (
                                <button
                                    type="button"
                                    className="blocks-layer-filter__clear blocks-layer-filter__clear--standalone"
                                    onClick={clearAll}
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {entryFilters.map((filter) => (
                <EntryField
                    key={filter.id}
                    filter={filter}
                    options={optionsByFilter?.[filter.id] ?? []}
                    selected={
                        typeof selections[filter.id] === 'string'
                            ? (selections[filter.id] as string)
                            : ''
                    }
                    entriesById={entriesById}
                    onClear={clearAll}
                    showClear={anyActive}
                    onChange={onChange}
                />
            ))}
        </div>
    )
}
