// The engine: apply a theme's facets to rows under the current selections.
//
// The one cascade rule (SCHEMA.md §8/§4): each facet's available options and
// counts are computed from the rows that pass every OTHER facet — never
// itself. That single rule yields all the adaptive-dropdown behavior, and
// "you can always switch a facet's value without clearing it first".
//
// Invalidation: a selected value that is no longer among its facet's
// available options auto-clears. Clearing can widen other facets, so we
// iterate to a fixed point (bounded by facet count).

import type {
    EngineResult,
    EngineTheme,
    EnumeratedFacet,
    FacetOption,
    FacetSelections,
    Row,
} from './types'
import { casefold } from './derive'
import { rowFacetValues, rowPassesFacet, selectionKeys } from './facets'

function isEnumerated(facet: EngineTheme['facets'][number]): facet is EnumeratedFacet {
    return facet.kind !== 'predicate'
}

/** Distinct-count key: entries for entry-sourced facets, layers otherwise. */
function countKey(row: Row, facet: EnumeratedFacet): string {
    return facet.source === 'layer' ? row.layerKey : row.entry?.id ?? row.layerKey
}

function availableOptions(
    rows: Row[],
    theme: EngineTheme,
    facet: EnumeratedFacet,
    selections: FacetSelections,
    now: number,
): FacetOption[] {
    const passingOthers = rows.filter((row) =>
        theme.facets.every(
            (other) =>
                other.id === facet.id ||
                rowPassesFacet(row, other, selections[other.id], now),
        ),
    )

    // casefold key -> first-seen display value + distinct carriers
    const byKey = new Map<string, { value: string; carriers: Set<string> }>()
    for (const row of passingOthers) {
        for (const value of rowFacetValues(row, facet, now)) {
            const key = casefold(value)
            if (key === '') continue
            const existing = byKey.get(key)
            if (existing) existing.carriers.add(countKey(row, facet))
            else byKey.set(key, { value, carriers: new Set([countKey(row, facet)]) })
        }
    }
    return [...byKey.values()]
        .map(({ value, carriers }) => ({ value, count: carriers.size }))
        .sort((a, b) => a.value.localeCompare(b.value))
}

export interface ApplyOptions {
    /** Injected clock for derived year spans / ongoing checks (testable). */
    now?: number
    /**
     * The facet the user just changed. When selections contradict each other,
     * this one is authoritative and never auto-cleared — the stale others
     * adjust around it ("most recent action wins"). Without the hint,
     * contradictions clear the earliest invalid facet in definition order.
     */
    changedFacetId?: string
}

export function applyTheme(
    allRows: Row[],
    theme: EngineTheme,
    selections: FacetSelections,
    options: ApplyOptions = {},
): EngineResult {
    const now = options.now ?? Date.now()
    const rows = theme.requireEntry === true
        ? allRows.filter((row) => row.entry != null)
        : allRows

    // Fixed-point invalidation: clear selected values that fell out of their
    // facet's availability; each pass can only shrink selections, so this
    // terminates within facets.length iterations.
    const current: FacetSelections = { ...selections }
    for (let pass = 0; pass <= theme.facets.length; pass++) {
        let changed = false
        for (const facet of theme.facets) {
            if (!isEnumerated(facet)) continue
            if (facet.id === options.changedFacetId) continue
            const selected = selectionKeys(current[facet.id])
            if (selected.length === 0) continue
            const available = new Set(
                availableOptions(rows, theme, facet, current, now).map((o) =>
                    casefold(o.value),
                ),
            )
            const kept = selected.filter((key) => available.has(key))
            if (kept.length !== selected.length) {
                const raw = current[facet.id]
                current[facet.id] = Array.isArray(raw)
                    ? raw.filter((v) => available.has(casefold(v)))
                    : kept.length === 0
                      ? null
                      : raw
                changed = true
            }
        }
        if (!changed) break
    }

    const optionsByFacet: Record<string, FacetOption[]> = {}
    for (const facet of theme.facets) {
        if (isEnumerated(facet)) {
            optionsByFacet[facet.id] = availableOptions(rows, theme, facet, current, now)
        }
    }

    const surviving = rows.filter((row) =>
        theme.facets.every((facet) =>
            rowPassesFacet(row, facet, current[facet.id], now),
        ),
    )
    const layerKeys: string[] = []
    for (const row of surviving) {
        if (!layerKeys.includes(row.layerKey)) layerKeys.push(row.layerKey)
    }

    return { options: optionsByFacet, rows: surviving, layerKeys, selections: current }
}
