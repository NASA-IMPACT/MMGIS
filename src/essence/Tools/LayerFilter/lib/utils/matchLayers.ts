// Pure matcher — no MMGIS imports, no DOM, no network. Given the layer configs
// and the active theme + selections, return the names of layers that match.
//
// A layer "matches" when:
//   - its properties[themeProperty] equals the selected theme id, AND
//   - for every active selection, its properties[property] equals that value.
// An empty/absent selection value means "all" (that filter is ignored).
// Missing properties simply don't match — so it degrades gracefully until STAC
// actually populates `properties`.
import type { FilterSelections } from '../types'

export interface LayerLike {
    type?: unknown
    properties?: Record<string, unknown>
}

/**
 * A layer property matches a target value when it equals it (scalar) or
 * contains it (array). Array support lets a layer belong to several themes /
 * carry several hazards, e.g. `properties.theme = ['need','hazard','event']`.
 */
function valueMatches(propValue: unknown, target: string): boolean {
    if (Array.isArray(propValue)) {
        return propValue.map((v) => String(v)).includes(target)
    }
    return String(propValue ?? '') === target
}

export function matchLayers(
    layerConfigs: Record<string, LayerLike> | null | undefined,
    themeProperty: string,
    themeId: string,
    selections: FilterSelections,
): string[] {
    const matched: string[] = []
    if (!layerConfigs) return matched

    for (const [name, cfg] of Object.entries(layerConfigs)) {
        const props = (cfg && cfg.properties) || {}

        // Theme gate.
        if (themeProperty && !valueMatches(props[themeProperty], themeId)) {
            continue
        }

        // Every active selection must match.
        let ok = true
        for (const [property, value] of Object.entries(selections || {})) {
            if (value === '' || value == null) continue // "all"
            if (!valueMatches(props[property], value)) {
                ok = false
                break
            }
        }
        if (ok) matched.push(name)
    }
    return matched
}

/**
 * The full listed-flag map to apply for a match result: every real layer gets
 * an entry (matched → true, unmatched → false) so applying a new filter also
 * restores layers the previous one hid. Headers are skipped — they're
 * grouping nodes, not listable layers.
 */
export function buildListedUpdates(
    layerConfigs: Record<string, LayerLike> | null | undefined,
    matchedLayerNames: string[],
): Record<string, boolean> {
    const matched = new Set(matchedLayerNames)
    const updates: Record<string, boolean> = {}
    for (const [name, cfg] of Object.entries(layerConfigs || {})) {
        if (cfg?.type === 'header') continue
        updates[name] = matched.has(name)
    }
    return updates
}
