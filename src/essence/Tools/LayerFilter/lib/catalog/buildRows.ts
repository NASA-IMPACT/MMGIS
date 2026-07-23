// Pure row construction — joins layers to parsed catalogue entries via each
// layer's stable key. Produces the engine's working set: one row per
// resolved pairing, plus one unpaired row per layer with no pairings.
// Dangling keys (catalogue references no layer carries) warn and skip.

import type { Row } from '../engine/types'
import type { ParsedCatalog } from './parseCatalog'

export interface LayerInput {
    /** Runtime identity (in MMGIS: the layer UUID). */
    layerKey: string
    /** The layer's tag properties; its stable key lives here too. */
    layerProps: Record<string, unknown>
}

export interface BuiltRows {
    rows: Row[]
    warnings: string[]
}

export function buildRows(
    layers: LayerInput[],
    catalog: ParsedCatalog,
    /** Which layerProps field holds the stable key (SCHEMA.md §4). */
    keyProperty: string = 'key',
): BuiltRows {
    const warnings: string[] = []

    const byStableKey = new Map<string, LayerInput>()
    for (const layer of layers) {
        const stable = layer.layerProps[keyProperty]
        if (typeof stable === 'string' && stable !== '') {
            if (byStableKey.has(stable)) {
                warnings.push(
                    `Stable key "${stable}" is used by more than one layer — first one wins.`,
                )
            } else {
                byStableKey.set(stable, layer)
            }
        }
    }

    const rows: Row[] = []
    const paired = new Set<string>()

    for (const entry of catalog.entries) {
        for (const edge of catalog.edges[entry.id] ?? []) {
            const layer = byStableKey.get(edge.key)
            if (layer == null) {
                warnings.push(
                    `Catalog entry "${entry.id}" references layer key "${edge.key}" which no layer carries — skipped.`,
                )
                continue
            }
            rows.push({
                layerKey: layer.layerKey,
                layerProps: layer.layerProps,
                entry,
                edge: edge.attrs,
            })
            paired.add(layer.layerKey)
        }
    }

    for (const layer of layers) {
        if (!paired.has(layer.layerKey)) {
            rows.push({
                layerKey: layer.layerKey,
                layerProps: layer.layerProps,
                entry: null,
                edge: null,
            })
        }
    }

    return { rows, warnings }
}
