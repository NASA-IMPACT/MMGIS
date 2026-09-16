// Pure catalogue parsing — no MMGIS imports, no network. Input is whatever
// the Configure field (or a hosted URL later) provided: expected to be a
// GeoJSON FeatureCollection whose features are catalogue entries
// (SCHEMA.md §5). Fails soft: problems become warnings, never throws —
// a broken catalogue must leave layer-only themes functional.

import type { CatalogEntry } from '../engine/types'

/** One layer pairing as authored on an entry: stable key + edge attributes. */
export interface CatalogEdge {
    key: string
    /** Everything besides `key` (defaultOn, opacity, view, …) — opaque here. */
    attrs: Record<string, unknown>
}

export interface ParsedCatalog {
    entries: CatalogEntry[]
    /** entry id → its authored layer pairings. */
    edges: Record<string, CatalogEdge[]>
    warnings: string[]
}

const EMPTY: ParsedCatalog = { entries: [], edges: {}, warnings: [] }

function asRecord(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

export function parseCatalog(input: unknown): ParsedCatalog {
    const warnings: string[] = []
    const root = asRecord(input)
    if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
        if (input != null) {
            warnings.push(
                'Catalog is not a GeoJSON FeatureCollection — ignoring it.',
            )
        }
        return { ...EMPTY, warnings }
    }

    const entries: CatalogEntry[] = []
    const edges: Record<string, CatalogEdge[]> = {}
    const seen = new Set<string>()

    root.features.forEach((feature: unknown, index: number) => {
        const f = asRecord(feature)
        const id = typeof f.id === 'string' && f.id !== '' ? f.id : null
        if (id == null) {
            warnings.push(`Catalog feature #${index} has no id — skipped.`)
            return
        }
        if (seen.has(id)) {
            warnings.push(`Catalog feature "${id}" is duplicated — later copy skipped.`)
            return
        }
        seen.add(id)

        const properties = asRecord(f.properties)
        const { layers, start_datetime, end_datetime, ...facetProps } = properties

        const entryEdges: CatalogEdge[] = []
        if (layers != null && !Array.isArray(layers)) {
            warnings.push(`Catalog entry "${id}": properties.layers is not an array — ignored.`)
        } else {
            for (const pairing of (layers as unknown[]) ?? []) {
                const p = asRecord(pairing)
                if (typeof p.key !== 'string' || p.key === '') {
                    warnings.push(`Catalog entry "${id}": a layer pairing has no key — skipped.`)
                    continue
                }
                const { key, ...attrs } = p
                entryEdges.push({ key: key as string, attrs })
            }
        }

        entries.push({
            id,
            properties: facetProps,
            start: typeof start_datetime === 'string' ? start_datetime : null,
            end: typeof end_datetime === 'string' ? end_datetime : null,
            geometry: f.geometry ?? null,
        })
        edges[id] = entryEdges
    })

    return { entries, edges, warnings }
}
