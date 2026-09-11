import type { LayerMoveAction } from '../types'

/**
 * The layers in draw order, top first. Ids the order does not name keep their
 * relative order and follow the ranked ones; no order at all leaves the list
 * as given.
 */
export const sortByOrder = <T extends { id: string }>(
    layers: T[],
    order: string[] | null | undefined,
): T[] => {
    if (!order || order.length === 0) return layers
    const rank = new Map(order.map((id, i) => [id, i]))
    const unranked = order.length
    return [...layers].sort(
        (a, b) => (rank.get(a.id) ?? unranked) - (rank.get(b.id) ?? unranked),
    )
}

/**
 * The full draw order after moving one layer. A step moves it past its
 * neighbour in `shown` — the list the user is looking at — not past whatever
 * hidden layer sits next to it in the full order, so every step is visible.
 * Null when there is nowhere to go.
 */
export const moveInOrder = (
    order: string[],
    shown: string[],
    id: string,
    action: LayerMoveAction,
): string[] | null => {
    if (!order.includes(id)) return null
    const rest = order.filter((other) => other !== id)

    if (action === 'top') {
        return order[0] === id ? null : [id, ...rest]
    }
    if (action === 'bottom') {
        return order[order.length - 1] === id ? null : [...rest, id]
    }

    const at = shown.indexOf(id)
    if (at === -1) return null
    const neighbour = shown[action === 'up' ? at - 1 : at + 1]
    if (neighbour == null) return null
    const slot = rest.indexOf(neighbour)
    if (slot === -1) return null
    const insertAt = action === 'up' ? slot : slot + 1
    return [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)]
}
