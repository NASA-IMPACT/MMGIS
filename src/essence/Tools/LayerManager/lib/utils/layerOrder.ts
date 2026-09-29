/**
 * Where a dragged row was dropped: the index in `ids` of the row under it.
 * Null when it was dropped on nothing, on itself, or on a row no longer
 * listed.
 */
export const dropIndex = (
    ids: string[],
    active: string | number,
    over: { id: string | number } | null | undefined,
): number | null => {
    if (over == null || over.id === active) return null
    const index = ids.indexOf(String(over.id))
    return index === -1 ? null : index
}

/**
 * The full draw order after dropping one layer at `toIndex` of `shown`, the
 * list the user dragged it through. It lands next to the last shown layer it
 * passed — just above the one now below it when dragged up, just below the
 * one now above it when dragged down — so it never ends up under a hidden
 * layer that sits between two shown ones: a drop at the top lands just above
 * the first row shown. Null when nothing moves.
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

    // Dragged up, the row now below it is the one it passed last; dragged
    // down, the row now above it. Either exists, since `at` moved.
    const passedUp = toIndex < from
    const neighbour = passedUp ? moved[at + 1] : moved[at - 1]
    if (neighbour == null) return null

    const rest = order.filter((other) => other !== id)
    const slot = rest.indexOf(neighbour)
    if (slot === -1) return null
    const insertAt = passedUp ? slot : slot + 1
    return [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)]
}

type DragAnnouncement = {
    active: { id: string | number }
    over?: { id: string | number } | null
}

/**
 * What a screen reader hears during a drag: the layer's title and its
 * position from the top, where the library's defaults would read its id.
 */
export const orderAnnouncements = (layers: Array<{ id: string; title: string }>) => {
    const count = layers.length
    const title = (id: string | number) =>
        layers.find((l) => l.id === id)?.title ?? String(id)
    const position = (id: string | number) => layers.findIndex((l) => l.id === id) + 1
    return {
        onDragStart: ({ active }: DragAnnouncement) =>
            `Picked up ${title(active.id)}, position ${position(active.id)} of ${count}.`,
        onDragOver: ({ active, over }: DragAnnouncement) =>
            over
                ? `${title(active.id)} is at position ${position(over.id)} of ${count}.`
                : `${title(active.id)} is off the list.`,
        onDragEnd: ({ active, over }: DragAnnouncement) =>
            over
                ? `Dropped ${title(active.id)} at position ${position(over.id)} of ${count}.`
                : `Dropped ${title(active.id)} back at position ${position(active.id)} of ${count}.`,
        onDragCancel: ({ active }: DragAnnouncement) =>
            `Cancelled. ${title(active.id)} stays at position ${position(active.id)} of ${count}.`,
    }
}
