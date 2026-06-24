// Config-driven, generic 2-step filter. Step 1 = theme; step 2 = that theme's
// filters. Everything here is data the plugin renders — it knows nothing about
// what the filters mean.

export interface FilterOption {
    value: string
    label: string
}

/** One step-2 control (currently a select; room for more types later). */
export interface FilterDef {
    id: string
    label: string
    /** Which `layer.properties` key this filter matches against. */
    property: string
    type: 'select'
    /** Label for the "no selection / all" option (e.g. "All Sectors"). */
    allLabel?: string
    // FLAG (revisit): options are statically listed in config.json for now.
    // Values like Location/Year — and arguably all option lists — should instead
    // be derived from the data (the distinct `layer.properties[property]` values,
    // eventually from STAC) so they stay in sync without hand-maintenance.
    options: FilterOption[]
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
    filters: FilterDef[]
}

export interface LayerFilterConfig {
    /** `layer.properties` key that holds the theme id (default "theme"). */
    themeProperty: string
    defaultThemeId?: string
    themes: ThemeDef[]
}

/** Active step-2 choices: `layer.properties` key → selected value ("" = all). */
export type FilterSelections = Record<string, string>
