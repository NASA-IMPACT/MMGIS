// Resolve a filter's dropdown options. Options are derived from the data by
// default, so they stay in sync without hand-maintenance:
//   - explicit `filter.options` in config wins (for curated labels/order);
//   - `optionsFrom: 'time'` → years from the mission's configured time range;
//   - otherwise → the distinct `layer.properties[property]` values.
import type { FilterDef, FilterOption } from '../types'
import type { LayerLike } from './matchLayers'

function titleCase(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Distinct, sorted values of `properties[property]` across all layers (scalar or array). */
export function distinctValues(
    layerConfigs: Record<string, LayerLike> | null | undefined,
    property: string,
): string[] {
    const set = new Set<string>()
    for (const cfg of Object.values(layerConfigs || {})) {
        const v = cfg?.properties?.[property]
        if (Array.isArray(v)) {
            v.forEach((x) => {
                if (x != null && x !== '') set.add(String(x))
            })
        } else if (v != null && v !== '') {
            set.add(String(v))
        }
    }
    return [...set].sort()
}

export interface TimeConfigLike {
    initialstart?: string
    initialend?: string
}

/** Years (newest first) spanning the mission's configured time range. */
export function yearsFromTimeConfig(
    timeConfig: TimeConfigLike | null | undefined,
): string[] {
    const start = timeConfig?.initialstart
    const end = timeConfig?.initialend
    if (!start || !end) return []
    const startYear = new Date(start).getUTCFullYear()
    const endYear = new Date(end).getUTCFullYear()
    if (Number.isNaN(startYear) || Number.isNaN(endYear) || endYear < startYear) {
        return []
    }
    const years: string[] = []
    for (let y = endYear; y >= startYear; y--) years.push(String(y))
    return years
}

export function resolveOptions(
    filter: FilterDef,
    layerConfigs: Record<string, LayerLike> | null | undefined,
    timeConfig: TimeConfigLike | null | undefined,
): FilterOption[] {
    if (filter.options && filter.options.length) return filter.options
    const values =
        filter.optionsFrom === 'time'
            ? yearsFromTimeConfig(timeConfig)
            : distinctValues(layerConfigs, filter.property)
    return values.map((v) => ({ value: v, label: titleCase(v) }))
}
