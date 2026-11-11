import type { GroupInfo, Layer, LayerGroup, LayerListNode, LayerStructureNode } from '../types'

/** Where a moved item lands relative to the one it was dropped on. */
export type Placement = 'before' | 'after'

export const nodeId = (node: LayerListNode): string =>
    node.kind === 'layer' ? node.layer.id : node.group.id

export const nodeTitle = (node: LayerListNode): string =>
    node.kind === 'layer' ? node.layer.title : node.group.title

type Ranked = { node: LayerListNode; rank: number }

const byRank = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank

/**
 * The rows arranged under their groups. `rows` arrive top first in draw
 * order; each level is sorted by its top-most row. A group with nothing left
 * to show is dropped, and a row outside the structure sits at the top level.
 * A group missing from `groups` is titled by its id, with no description,
 * and starts collapsed.
 */
export const buildLayerList = (
    rows: Layer[],
    structure: LayerStructureNode[] | null | undefined,
    groups: Record<string, GroupInfo> = {},
): LayerListNode[] => {
    const rank = new Map(rows.map((row, index) => [row.id, index]))
    const byId = new Map(rows.map((row) => [row.id, row]))
    const placed = new Set<string>()

    const build = (nodes: LayerStructureNode[] | undefined): Ranked[] => {
        const out: Ranked[] = []
        for (const node of nodes ?? []) {
            if (node.kind === 'group') {
                const children = build(node.children)
                if (children.length === 0) continue
                out.push({
                    node: {
                        kind: 'group',
                        group: {
                            title: node.id,
                            description: null,
                            expanded: false,
                            ...groups[node.id],
                            id: node.id,
                            children: children.map((c) => c.node),
                        },
                    },
                    rank: children[0].rank,
                })
            } else {
                const layer = byId.get(node.id)
                if (!layer || placed.has(node.id)) continue
                placed.add(node.id)
                out.push({ node: { kind: 'layer', layer }, rank: rank.get(node.id) as number })
            }
        }
        return out.sort(byRank)
    }

    const top = build(structure ?? [])
    for (const row of rows) {
        if (!placed.has(row.id)) {
            top.push({ node: { kind: 'layer', layer: row }, rank: rank.get(row.id) as number })
        }
    }
    return top.sort(byRank).map((r) => r.node)
}

/** The sibling list holding `id`, searched depth first. */
const siblingsOf = <T extends { id: string; children?: T[] }>(
    list: T[],
    id: string,
): T[] | null => {
    if (list.some((n) => n.id === id)) return list
    for (const n of list) {
        if (n.children) {
            const found = siblingsOf(n.children, id)
            if (found) return found
        }
    }
    return null
}

type Indexed = { id: string; children?: Indexed[] }

const indexList = (nodes: LayerListNode[]): Indexed[] =>
    nodes.map((n) =>
        n.kind === 'layer'
            ? { id: n.layer.id }
            : { id: n.group.id, children: indexList(n.group.children) },
    )

/**
 * Where a drop of `activeId` on `overId` lands in the shown list: before the
 * target when dragged up, after it when dragged down. Null unless the two are
 * siblings, so nothing leaves its group and nothing joins one.
 */
export const resolveDrop = (
    nodes: LayerListNode[],
    activeId: string,
    overId: string | null | undefined,
): Placement | null => {
    if (overId == null || overId === activeId) return null
    const siblings = siblingsOf(indexList(nodes), activeId)
    if (!siblings) return null
    const from = siblings.findIndex((n) => n.id === activeId)
    const to = siblings.findIndex((n) => n.id === overId)
    if (to === -1) return null
    return to < from ? 'before' : 'after'
}

type FullNode = { id: string; rank: number; children?: FullNode[] }

/**
 * The full draw order after moving `activeId` just before or after `overId`:
 * its sibling, or a layer inside a sibling group, in which case the move
 * lands just before or after that group. Every layer counts here, including
 * those filtered out of the list: a group's hidden layers move with it, and a
 * moved group lands as one contiguous block. Without a structure, every layer is a sibling of every
 * other and the moved one lands right beside `overId`, so hidden layers
 * keep their place. With one, the result draws each group as one block,
 * which core's draw order already does unless a config reload has split a
 * group. Null when `overId` is neither a sibling nor inside one, so nothing
 * leaves its group, or when nothing changes.
 */
export const placeInTree = (
    order: string[],
    structure: LayerStructureNode[] | null | undefined,
    activeId: string,
    overId: string,
    placement: Placement,
): string[] | null => {
    if (activeId === overId) return null
    const rank = new Map(order.map((id, index) => [id, index]))
    const seen = new Set<string>()

    const build = (nodes: LayerStructureNode[] | undefined): FullNode[] => {
        const out: FullNode[] = []
        for (const node of nodes ?? []) {
            if (node.kind === 'group') {
                const children = build(node.children)
                out.push({
                    id: node.id,
                    rank: children.length ? children[0].rank : Infinity,
                    children,
                })
            } else if (rank.has(node.id) && !seen.has(node.id)) {
                seen.add(node.id)
                out.push({ id: node.id, rank: rank.get(node.id) as number })
            }
        }
        return out.sort(byRank)
    }

    const root = build(structure ?? [])
    for (const id of order) {
        if (!seen.has(id)) root.push({ id, rank: rank.get(id) as number })
    }
    root.sort(byRank)

    // `overId` may sit inside a sibling group, as any row does in a flat
    // list; the move then lands beside that group.
    const holds = (node: FullNode): boolean =>
        node.id === overId || (node.children ?? []).some(holds)
    const siblings = siblingsOf(root, activeId)
    if (!siblings) return null
    const [moved] = siblings.splice(
        siblings.findIndex((n) => n.id === activeId),
        1,
    )
    const target = siblings.findIndex(holds)
    if (target === -1) return null
    siblings.splice(placement === 'before' ? target : target + 1, 0, moved)

    const next: string[] = []
    const flatten = (list: FullNode[]) =>
        list.forEach((n) => (n.children ? flatten(n.children) : next.push(n.id)))
    flatten(root)

    if (next.length !== order.length) return null
    if (next.every((id, index) => id === order[index])) return null
    return next
}

type DragAnnouncement = {
    active: { id: string | number }
    over?: { id: string | number } | null
}

/**
 * What a screen reader hears while dragging a list: the item's title, its
 * position among its siblings, and the group holding it. Over an item that
 * is not a sibling, it hears that the item stays in its own group, since
 * such a drop moves nothing.
 */
export const treeAnnouncements = (nodes: LayerListNode[]) => {
    type Info = {
        title: string
        position: number
        count: number
        group: string | null
        parent: string | null
    }
    const info = new Map<string, Info>()
    const walk = (list: LayerListNode[], group: LayerGroup | null) => {
        list.forEach((n, index) => {
            info.set(nodeId(n), {
                title: nodeTitle(n),
                position: index + 1,
                count: list.length,
                group: group?.title ?? null,
                parent: group?.id ?? null,
            })
            if (n.kind === 'group') walk(n.group.children, n.group)
        })
    }
    walk(nodes, null)

    const title = (id: string | number) => info.get(String(id))?.title ?? String(id)
    const where = (id: string | number) => {
        const at = info.get(String(id))
        if (!at) return ''
        return `position ${at.position} of ${at.count}${at.group ? ` in ${at.group}` : ''}`
    }
    const siblings = (a: string | number, b: string | number) => {
        const from = info.get(String(a))
        const to = info.get(String(b))
        return from != null && to != null && from.parent === to.parent
    }
    const staysIn = (id: string | number) => {
        const group = info.get(String(id))?.group
        return group ? `in ${group}` : 'outside any group'
    }
    return {
        onDragStart: ({ active }: DragAnnouncement) =>
            `Picked up ${title(active.id)}, ${where(active.id)}.`,
        onDragOver: ({ active, over }: DragAnnouncement) => {
            if (!over) return `${title(active.id)} is off the list.`
            if (!siblings(active.id, over.id))
                return `${title(active.id)} can only move ${staysIn(active.id)}.`
            return `${title(active.id)} is at ${where(over.id)}.`
        },
        onDragEnd: ({ active, over }: DragAnnouncement) =>
            over && siblings(active.id, over.id)
                ? `Dropped ${title(active.id)} at ${where(over.id)}.`
                : `Dropped ${title(active.id)} back at ${where(active.id)}.`,
        onDragCancel: ({ active }: DragAnnouncement) =>
            `Cancelled. ${title(active.id)} stays at ${where(active.id)}.`,
    }
}
