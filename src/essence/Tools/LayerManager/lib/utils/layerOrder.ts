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

/**
 * The full draw order after dropping one layer at `toIndex` of `shown`, the
 * list the user dragged it through. It lands next to the last shown layer it
 * passed — just above the one now below it when dragged up, just below the
 * one now above it when dragged down — so it never ends up under a hidden
 * layer that sits between two shown ones. Null when nothing moves.
 */
export const placeInOrder = (
    order: string[],
    shown: string[],
    id: string,
    toIndex: number,
): string[] | null => {
    const from = shown.indexOf(id)
    if (from === -1 || !order.includes(id)) return null

    const moved = shown.filter((other) => other !== id)
    const at = Math.max(0, Math.min(toIndex, moved.length))
    if (at === from) return null
    moved.splice(at, 0, id)
    const above = moved[at - 1]
    const below = moved[at + 1]

    const rest = order.filter((other) => other !== id)
    const passedUp = toIndex < from
    let insertAt = -1
    if (passedUp && below != null) insertAt = rest.indexOf(below)
    else if (!passedUp && above != null) insertAt = rest.indexOf(above) + 1
    else if (below != null) insertAt = rest.indexOf(below)
    else if (above != null) insertAt = rest.indexOf(above) + 1
    if (insertAt < 0) return null

    const next = [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)]
    return next.every((other, i) => other === order[i]) ? null : next
}
