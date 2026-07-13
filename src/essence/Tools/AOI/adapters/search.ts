import type { Feature, FeatureCollection } from 'geojson'
import { slug } from './slug'

export type BoundaryKind = 'state' | 'county' | 'city'

/** A boundary entry in the search index — carries the source feature. */
export interface AOISearchEntry {
    id: string
    label: string
    kind: BoundaryKind
    feature: Feature
}

/** Flatten state/county/city FeatureCollections into a searchable entry list. */
export function buildSearchIndex(input: {
    states?: FeatureCollection | null
    counties?: FeatureCollection | null
    cities?: FeatureCollection | null
}): AOISearchEntry[] {
    const out: AOISearchEntry[] = []
    const push = (kind: BoundaryKind, fc?: FeatureCollection | null) => {
        if (!fc || !Array.isArray(fc.features)) return
        fc.features.forEach((f, i) => {
            const props = (f.properties ?? {}) as Record<string, unknown>
            const label =
                (props.name as string) ||
                (props.NAME as string) ||
                (props.title as string) ||
                `Unnamed ${kind} ${i + 1}`
            const id = (props.id as string) || `${kind}-${i}-${slug(label)}`
            out.push({ id, label, kind, feature: f })
        })
    }
    push('state', input.states)
    push('county', input.counties)
    push('city', input.cities)
    return out
}

/** Case-insensitive substring match over entry labels, capped at `limit`. */
export function searchIndex(
    query: string,
    entries: AOISearchEntry[],
    limit = 8,
): AOISearchEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: AOISearchEntry[] = []
    for (const e of entries) {
        if (e.label.toLowerCase().includes(q)) {
            out.push(e)
            if (out.length >= limit) break
        }
    }
    return out
}
