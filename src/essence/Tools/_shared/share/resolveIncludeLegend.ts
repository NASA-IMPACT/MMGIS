// Whether the legend band is appended to a PNG/PDF export. Shared by the
// ShareExport and MapControl adapters, which previously each resolved this
// with a different truthiness rule (`!== false` vs. an explicit
// false/'false'/0/'0' set) — Configure's checkbox field can persist any of
// those forms, so the two disagreed on a saved 'false' string. This is the
// wider rule (MapControl's original), so both consumers now agree.

export type IncludeLegendVars = { includeLegend?: unknown }

const isFalsy = (v: unknown): boolean =>
    v === false || v === 'false' || v === 0 || v === '0'

/** The legend band defaults to on; an unset or non-falsy value is enabled. */
export function resolveIncludeLegend(vars?: IncludeLegendVars | null): boolean {
    return !isFalsy((vars || {}).includeLegend)
}
