// Maps the configured theme shape (types.ts) onto an engine theme
// (lib/engine). Pure, total: unknown combinations degrade to a layer facet.

import type { FilterDef, GeocodeSelection, ThemeDef } from '../types'
import type { EngineTheme, Facet, Row } from '../engine/types'
import { geometriesIntersect } from './geo'

export function toEngineFacet(
    filter: FilterDef,
    opts: { catalogTheme?: boolean } = {},
): Facet {
    if (filter.type === 'geocode') {
        // Predicate facet testing the geometry of the unit the theme filters.
        // Catalog themes locate activations, so only entry geometry counts —
        // a wide-area layer must not keep far-away activations selectable.
        // Layer themes locate layers: the layer's own extent when it has one,
        // else its activations' geometry as a proxy.
        const catalogTheme = opts.catalogTheme === true
        return {
            id: filter.id,
            kind: 'predicate',
            test: (row: Row, selection: unknown) => {
                const place = (selection as GeocodeSelection | null)?.geometry
                const subject = catalogTheme
                    ? row.entry?.geometry
                    : row.layerGeometry ?? row.entry?.geometry
                return geometriesIntersect(subject, place)
            },
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
    const catalogTheme = theme.catalog != null
    return {
        id: theme.id,
        requireEntry: catalogTheme,
        facets: theme.filters.map((filter) =>
            toEngineFacet(filter, { catalogTheme }),
        ),
    }
}
