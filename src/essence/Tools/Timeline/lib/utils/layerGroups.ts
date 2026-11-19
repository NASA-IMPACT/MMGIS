import type { LayerTimeData } from '../types'

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
          /** The colour of the group's bars while it is folded. */
          color: string
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

type Built = { rows: TimelineRow[]; members: LayerTimeData[]; rank: number }

/**
 * Flattens the grouping into rows. `layers` arrive top first in draw order,
 * and each level is sorted by its top-most layer, so a group sits where its
 * first shown layer does — the order the layer list shows. Only layers in
 * `layers` are shown, each once; a group left with none of them is dropped.
 * A collapsed group contributes its own row and hides everything beneath it.
 * A layer outside the grouping sits at the top level.
 */
export function buildTimelineRows(
    tree: LayerGroupNode[] | null | undefined,
    layers: LayerTimeData[],
    collapsed: ReadonlySet<string>
): TimelineRow[] {
    const rank = new Map(layers.map((layer, index) => [layer.name, index]))
    const placed = new Set<string>()
    const byRank = (a: Built, b: Built) => a.rank - b.rank

    const leaf = (layer: LayerTimeData, depth: number): Built => ({
        rows: [{ kind: 'layer', layer, depth }],
        members: [layer],
        rank: rank.get(layer.name) as number,
    })

    // Each node yields its rows and the layers under it, whether or not a
    // collapse hides them, for the group's combined coverage.
    const build = (nodes: LayerGroupNode[], depth: number): Built[] => {
        const out: Built[] = []
        for (const node of nodes) {
            if (node.kind === 'layer') {
                const index = rank.get(node.id)
                if (index === undefined || placed.has(node.id)) continue
                placed.add(node.id)
                out.push(leaf(layers[index], depth))
                continue
            }

            const children = build(node.children, depth + 1)
            if (children.length === 0) continue
            const members = children.flatMap((child) => child.members)
            const isCollapsed = collapsed.has(node.id)
            out.push({
                rows: [
                    {
                        kind: 'group',
                        id: node.id,
                        displayName: node.displayName,
                        depth,
                        collapsed: isCollapsed,
                        summary: {
                            name: node.id,
                            displayName: node.displayName,
                            color: node.color,
                            timeRanges: members.flatMap((m) => m.timeRanges),
                            navigation: null,
                        },
                    },
                    ...(isCollapsed ? [] : children.flatMap((c) => c.rows)),
                ],
                members,
                rank: children[0].rank,
            })
        }
        return out.sort(byRank)
    }

    const top = build(tree ?? [], 0)
    for (const layer of layers) {
        if (!placed.has(layer.name)) top.push(leaf(layer, 0))
    }
    return top.sort(byRank).flatMap((built) => built.rows)
}
