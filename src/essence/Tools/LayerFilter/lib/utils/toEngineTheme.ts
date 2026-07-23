// Maps the configured theme shape (types.ts) onto an engine theme
// (lib/engine). Pure, total: unknown combinations degrade to a layer facet.

import type { FilterDef, ThemeDef } from '../types'
import type { EngineTheme, Facet } from '../engine/types'

export function toEngineFacet(filter: FilterDef): Facet {
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
