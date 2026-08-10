// Config-driven, generic 2-step filter. Step 1 = theme; step 2 = that theme's
// filters. Everything here is data the plugin renders — it knows nothing about
// what the filters mean. Filters map 1:1 onto engine facets (lib/engine):
// options and counts are always derived from the data, never enumerated here.

/**
 * One step-2 control. Where its values come from:
 *   - default: `layer.properties[property]` (layer-scoped facet)
 *   - `from: 'catalog'` + `property`: catalogue entry properties
 *   - `from: 'catalog'` + `derived: 'datetimes'`: entry year spans
 *   - `from: 'catalog'` + `isEntry: true`: the pick-one-entry control
 */
export interface FilterDef {
    id: string
    label?: string
    /** Property key on the layer (default source) or catalogue entry. */
    property?: string
    from?: 'catalog'
    derived?: 'datetimes'
    isEntry?: boolean
    /** 'geocode' renders a place search; entries pass by geometry intersection. */
    type?: 'geocode'
    multi?: boolean
    /** Multi-select semantics: any-overlap (default) or contains-all. */
    matchAll?: boolean
    /** Label for the "no selection / all" option (e.g. "All Sectors"). */
    allLabel?: string
    /** isEntry pickers: noun for the count line (e.g. "activations"). */
    countLabel?: string
}

/** One step-1 theme: a rail entry + the step-2 filters it reveals. */
export interface ThemeDef {
    id: string
    /** Rail label, e.g. "Need". */
    label: string
    /** Rail icon (Material/MDI name). */
    icon?: string
    /** Panel heading, e.g. "Need". */
    title: string
    /** Panel sub-text under the title. */
    description?: string
    /**
     * Names the catalogue this theme filters (e.g. "activations"). Scopes the
     * theme to catalogue-paired rows and enables `from: 'catalog'` filters.
     */
    catalog?: string
    filters: FilterDef[]
}

export interface LayerFilterConfig {
    defaultThemeId?: string
    themes: ThemeDef[]
    /** The catalogue (GeoJSON FeatureCollection) — see SCHEMA.md §5. */
    catalog?: unknown
    /** External geocoder for 'geocode' filters. Absent → those controls hide. */
    geocoder?: { url?: string }
}

/** A chosen place: label for the chip, geometry for the intersection test. */
export interface GeocodeSelection {
    label: string
    geometry: unknown
}

/**
 * Active step-2 choices, keyed by filter id — two filters may share a
 * `property` without sharing selection state. Single-select filters hold a
 * string; multi-select hold string[]; geocode filters hold a
 * GeocodeSelection. "" / [] / null / absent all mean "all".
 */
export type FilterSelections = Record<
    string,
    string | string[] | GeocodeSelection | null
>
