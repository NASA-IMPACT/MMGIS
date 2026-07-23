// Faceted filter engine — pure and app-agnostic. The working set is rows:
// one per (layer, catalog-entry) pairing plus one per unpaired layer. Every
// filter — including a "pick one entry" control — is a facet over rows.
// The engine knows nothing about what any property means.

/** A catalog entry: something with an id, tags, a time range, a geometry. */
export interface CatalogEntry {
    id: string
    properties: Record<string, unknown>
    /** ISO datetimes; end null/absent = ongoing. */
    start: string | null
    end: string | null
    /** Opaque to the engine; predicate facets may test it. */
    geometry?: unknown
}

/** One unit of the working set. `entry`/`edge` are null for unpaired layers. */
export interface Row {
    layerKey: string
    layerProps: Record<string, unknown>
    entry: CatalogEntry | null
    /** Per-pairing attributes (opaque; carried through for consumers). */
    edge: Record<string, unknown> | null
}

/**
 * A dropdown-style facet. `source` says where a row's values come from:
 *   'layer'      — layerProps[property]
 *   'entry'      — entry.properties[property]
 *   'entryId'    — the entry's id (a pick-one-entry control)
 *   'entryYears' — derived from the entry's full start..end year span
 */
export interface EnumeratedFacet {
    id: string
    kind?: 'enumerated'
    source: 'layer' | 'entry' | 'entryId' | 'entryYears'
    property?: string
    multi?: boolean
    /** Multi-select semantics: any-overlap (default) or contains-all. */
    matchAll?: boolean
}

/** An arbitrary row test (e.g. geometry intersection). No option list. */
export interface PredicateFacet {
    id: string
    kind: 'predicate'
    test: (row: Row, selection: unknown) => boolean
}

export type Facet = EnumeratedFacet | PredicateFacet

export interface EngineTheme {
    id: string
    /** Catalogue-scoped themes drop rows without an entry. */
    requireEntry?: boolean
    facets: Facet[]
}

/**
 * facetId → current selection. Enumerated: string or string[] ("", [] and
 * null all mean "no narrowing"). Predicate: any value the test understands,
 * null = inactive.
 */
export type FacetSelections = Record<string, unknown>

export interface FacetOption {
    /** Display value (first-seen casing wins; matching is case-insensitive). */
    value: string
    /** Distinct layers (layer-sourced) or entries (entry-sourced) carrying it. */
    count: number
}

export interface EngineResult {
    /** Per enumerated facet: available options, own-facet exempted. */
    options: Record<string, FacetOption[]>
    /** Rows passing every facet. */
    rows: Row[]
    /** Distinct layerKeys of surviving rows, first-seen order. */
    layerKeys: string[]
    /** Input selections after auto-clearing values no longer available. */
    selections: FacetSelections
}
