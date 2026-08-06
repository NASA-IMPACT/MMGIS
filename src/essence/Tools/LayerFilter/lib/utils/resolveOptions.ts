// Resolve a filter's dropdown options. Options are derived from the data by
// default, so they stay in sync without hand-maintenance:
//   - explicit `filter.options` in config wins (for curated labels/order);
//   - `optionsFrom: 'time'` → years from the mission's resolved time range,
//     falling back to the data when no usable range exists;
//   - otherwise → the distinct `layer.properties[property]` values.
import type { FilterDef, FilterOption } from '../types'
import type { LayerLike } from './matchLayers'

function titleCase(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Distinct, sorted values of `properties[property]` across all layers
 * (scalar or array). Deduped case-insensitively — hand-authored tags like
 * "Water"/"water" merge into one option, first-seen casing displayed —
 * matching the matcher's case-insensitive comparisons.
 */
export function distinctValues(
    layerConfigs: Record<string, LayerLike> | null | undefined,
    property: string,
): string[] {
    const byKey = new Map<string, string>()
    const add = (x: unknown) => {
        if (x == null || x === '') return
        const display = String(x)
        const key = display.trim().toLowerCase()
        if (key !== '' && !byKey.has(key)) byKey.set(key, display)
    }
    for (const cfg of Object.values(layerConfigs || {})) {
        const v = cfg?.properties?.[property]
        if (Array.isArray(v)) v.forEach(add)
        else add(v)
    }
    return [...byKey.values()].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
}

/** Resolved mission time range (epoch-parseable strings), as served by the
 *  core's `time:getStart`/`time:getEnd` accessors — relative config forms
 *  like "now" or "now - 1 day" are already resolved by TimeControl. */
export interface TimeRangeLike {
    start?: string
    end?: string
}

/** A typo'd year range would otherwise render thousands of options. */
const MAX_YEAR_SPAN = 150

/** Years (newest first) spanning the resolved time range; [] when the range
 *  is missing or unparseable (callers fall back to data-derived options). */
export function yearsFromTimeConfig(
    timeRange: TimeRangeLike | null | undefined,
): string[] {
    const start = timeRange?.start
    const end = timeRange?.end
    if (!start || !end) return []
    let startYear = new Date(start).getUTCFullYear()
    const endYear = new Date(end).getUTCFullYear()
    if (Number.isNaN(startYear) || Number.isNaN(endYear) || endYear < startYear) {
        return []
    }
    if (endYear - startYear > MAX_YEAR_SPAN) {
        console.warn(
            `[LayerFilter] time range spans ${endYear - startYear} years — capping Year options at ${MAX_YEAR_SPAN}`,
        )
        startYear = endYear - MAX_YEAR_SPAN
    }
    const years: string[] = []
    for (let y = endYear; y >= startYear; y--) years.push(String(y))
    return years
}

export function resolveOptions(
    filter: FilterDef,
    layerConfigs: Record<string, LayerLike> | null | undefined,
    timeRange: TimeRangeLike | null | undefined,
): FilterOption[] {
    if (filter.options && filter.options.length) return filter.options
    if (filter.optionsFrom === 'time') {
        const years = yearsFromTimeConfig(timeRange)
        if (years.length > 0) {
            return years.map((v) => ({ value: v, label: v }))
        }
        // No usable time range (time disabled, still loading, unparseable):
        // fall back to the data so the dropdown isn't permanently empty.
    }
    return distinctValues(layerConfigs, filter.property).map((v) => ({
        value: v,
        label: titleCase(v),
    }))
}
