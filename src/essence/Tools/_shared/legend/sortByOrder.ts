/**
 * The layers in draw order, top first. Ids the order does not name keep their
 * relative order and follow the ranked ones; no order at all leaves the list
 * as given.
 */
export const sortByOrder = <T extends { id: string }>(
    layers: T[],
    order: string[] | null | undefined,
): T[] => {
    if (!order || order.length === 0) return [...layers]
    const rank = new Map(order.map((id, i) => [id, i]))
    const unranked = order.length
    return [...layers].sort(
        (a, b) => (rank.get(a.id) ?? unranked) - (rank.get(b.id) ?? unranked),
    )
}
