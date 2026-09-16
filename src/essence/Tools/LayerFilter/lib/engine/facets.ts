// Per-facet mechanics: what values a row carries for a facet, and whether a
// row passes a facet given the current selection.

import type { EnumeratedFacet, Facet, Row } from './types'
import { casefold, yearSpan } from './derive'

function toArray(value: unknown): unknown[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

/** A row's display values for an enumerated facet (may be empty). */
export function rowFacetValues(
    row: Row,
    facet: EnumeratedFacet,
    now: number,
): string[] {
    switch (facet.source) {
        case 'layer':
            return toArray(row.layerProps[facet.property ?? '']).map(String)
        case 'entry':
            if (row.entry == null) return []
            return toArray(row.entry.properties[facet.property ?? '']).map(String)
        case 'entryId':
            return row.entry == null ? [] : [row.entry.id]
        case 'entryYears':
            if (row.entry == null) return []
            return yearSpan(row.entry.start, row.entry.end, now)
    }
}

/** Selection normalized to casefolded keys; [] = facet inactive. */
export function selectionKeys(selection: unknown): string[] {
    return toArray(selection)
        .map(casefold)
        .filter((key) => key !== '')
}

export function rowPassesFacet(
    row: Row,
    facet: Facet,
    selection: unknown,
    now: number,
): boolean {
    if (facet.kind === 'predicate') {
        if (selection == null) return true
        return facet.test(row, selection)
    }

    const selected = selectionKeys(selection)
    if (selected.length === 0) return true

    const rowKeys = rowFacetValues(row, facet, now).map(casefold)
    if (facet.matchAll === true) {
        return selected.every((key) => rowKeys.includes(key))
    }
    return selected.some((key) => rowKeys.includes(key))
}
