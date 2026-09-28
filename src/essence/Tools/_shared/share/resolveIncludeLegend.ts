// Whether the legend band is appended to a PNG/PDF export. Shared by the
// ShareExport and MapControl adapters so the two can't disagree. Configure's
// checkbox field persists an unchecked box as any of false, 'false', 0 or
// '0', so all four read as off.

export type IncludeLegendVars = { includeLegend?: unknown }

const isFalsy = (v: unknown): boolean =>
    v === false || v === 'false' || v === 0 || v === '0'

/** The legend band defaults to on; an unset or non-falsy value is enabled. */
export function resolveIncludeLegend(vars?: IncludeLegendVars | null): boolean {
    return !isFalsy((vars || {}).includeLegend)
}
