import type { LayerTimeData, TimeRange } from '../types'

/**
 * The configured layer grouping, as the timeline reads it: a group names
 * itself and nests further nodes, a layer is referenced by its id alone and
 * its details come from the layer list.
 */
export type LayerGroupNode =
    | {
          kind: 'group'
          id: string
          displayName: string
          children: LayerGroupNode[]
      }
    | { kind: 'layer'; id: string }

/**
 * One row of the sidebar and the chart, in display order. The sidebar and the
 * chart are both drawn from the same list, so a name and its bars always sit
 * at the same index.
 */
export type TimelineRow =
    | { kind: 'layer'; layer: LayerTimeData; depth: number }
    | {
          kind: 'group'
          id: string
          displayName: string
          depth: number
          collapsed: boolean
          /**
           * The group's combined coverage, drawn on its row while collapsed.
           * Carries no navigation, so the row has no stepping controls.
           */
          summary: LayerTimeData
      }

/**
 * Overlapping and touching ranges joined into one, in time order. Labels are
 * dropped: a joined span no longer stands for a single named period.
 */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
    const sorted = [...ranges].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
    )
    const merged: TimeRange[] = []
    for (const range of sorted) {
        const last = merged[merged.length - 1]
        if (last && range.start.getTime() <= last.end.getTime()) {
            if (range.end.getTime() > last.end.getTime()) last.end = range.end
        } else {
            merged.push({ start: range.start, end: range.end })
        }
    }
    return merged
}

/**
 * Flattens the grouping into rows. Only layers in `layers` are shown; a group
 * left with none of them is dropped. A collapsed group contributes its own row
 * and hides everything beneath it. Layers the grouping does not mention are
 * listed after it, ungrouped, so a missing or partial grouping hides nothing.
 */
export function buildTimelineRows(
    tree: LayerGroupNode[] | null | undefined,
    layers: LayerTimeData[],
    collapsed: ReadonlySet<string>
): TimelineRow[] {
    const byName = new Map(layers.map((layer) => [layer.name, layer]))
    const placed = new Set<string>()

    // Each node yields its rows and the layers under it, whether or not a
    // collapse hides them, for the group's combined coverage.
    const walk = (
        nodes: LayerGroupNode[],
        depth: number
    ): { rows: TimelineRow[]; members: LayerTimeData[] } => {
        const rows: TimelineRow[] = []
        const members: LayerTimeData[] = []
        for (const node of nodes) {
            if (node.kind === 'layer') {
                const layer = byName.get(node.id)
                if (!layer || placed.has(node.id)) continue
                placed.add(node.id)
                rows.push({ kind: 'layer', layer, depth })
                members.push(layer)
                continue
            }

            const inner = walk(node.children, depth + 1)
            if (inner.members.length === 0) continue
            const isCollapsed = collapsed.has(node.id)
            rows.push({
                kind: 'group',
                id: node.id,
                displayName: node.displayName,
                depth,
                collapsed: isCollapsed,
                summary: {
                    name: node.id,
                    displayName: node.displayName,
                    color: inner.members[0].color,
                    timeRanges: mergeRanges(
                        inner.members.flatMap((layer) => layer.timeRanges)
                    ),
                    navigation: null,
                },
            })
            if (!isCollapsed) rows.push(...inner.rows)
            members.push(...inner.members)
        }
        return { rows, members }
    }

    const { rows } = walk(tree ?? [], 0)
    for (const layer of layers) {
        if (!placed.has(layer.name)) rows.push({ kind: 'layer', layer, depth: 0 })
    }
    return rows
}
