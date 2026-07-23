// Maps the configured theme shape (types.ts) onto an engine theme
// (lib/engine). Pure, total: unknown combinations degrade to a layer facet.

import type { FilterDef, GeocodeSelection, ThemeDef } from '../types'
import type { EngineTheme, Facet, Row } from '../engine/types'
import { geometriesIntersect } from './geo'

export function toEngineFacet(filter: FilterDef): Facet {
    if (filter.type === 'geocode') {
        // Predicate facet: a chosen place passes entries whose geometry
        // intersects it. Entry-less rows never match an active place.
        return {
            id: filter.id,
            kind: 'predicate',
            test: (row: Row, selection: unknown) =>
                geometriesIntersect(
                    row.entry?.geometry,
                    (selection as GeocodeSelection | null)?.geometry,
                ),
        }
    }
    if (filter.from === 'catalog') {
        if (filter.isEntry === true) {
            return { id: filter.id, source: 'entryId' }
        }
        if (filter.derived === 'datetimes') {
            return { id: filter.id, source: 'entryYears' }
        }
        return {
            id: filter.id,
            source: 'entry',
            property: filter.property,
            matchAll: filter.matchAll,
        }
    }
    return {
        id: filter.id,
        source: 'layer',
        property: filter.property,
        matchAll: filter.matchAll,
    }
}

export function toEngineTheme(theme: ThemeDef): EngineTheme {
    return {
        id: theme.id,
        requireEntry: theme.catalog != null,
        facets: theme.filters.map(toEngineFacet),
    }
}
