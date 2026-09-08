import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export type CollapseIfItAddsARowOptions = {
    /**
     * The wrapping flex row the item sits in. Its children are what the line
     * count is read from, so every control in the row must be one of them.
     */
    rowRef: RefObject<HTMLElement | null>
    /** The item that collapses. The collapsed class is toggled on this node. */
    itemRef: RefObject<HTMLElement | null>
    /** Class that puts the item into its collapsed configuration. */
    collapsedClass: string
    /** While false nothing is measured and the item stays expanded. */
    enabled?: boolean
    /**
     * A value summarizing what the row holds. The measurement reads the DOM
     * rather than props, so there is nothing for the hook to compare on its
     * own; changing this is how a caller says the row's contents moved and the
     * answer has to be taken again. Width changes need no help — those arrive
     * through the row's own resize observer.
     */
    signature?: string
}

/**
 * Distinct top edges across a flex container's children, which is its line
 * count: every item on a wrapped line shares a top, and each line starts a new
 * one. Rounded, so subpixel positions within a line still read as one line.
 */
function countRows(row: HTMLElement): number {
    const tops = new Set<number>()
    for (const child of Array.from(row.children)) {
        tops.add(Math.round(child.getBoundingClientRect().top))
    }
    return tops.size
}

/**
 * Decides whether an item in a wrapping row should hold its collapsed
 * configuration: it collapses exactly when expanding it would cost the row an
 * extra line, and expands whenever the full form is free — either because the
 * row has the width to spare, or because the item has already been wrapped onto
 * a line of its own, where the space is there whether it is used or not.
 *
 * Both configurations are measured outright, one after the other, by forcing
 * the class on and then off and reading the line count each time. The double
 * pass is deliberate: comparing the two is the whole rule, and a single
 * reading of whatever is on screen could not express it.
 *
 * That is also what keeps the result stable. Each pass measures a fixed,
 * fully-specified configuration, so neither reading depends on which
 * configuration is currently displayed; the comparison is a function of the
 * row's width and its contents alone. Neither input moves when the answer is
 * applied — the row takes its width from its parent rather than from its
 * items, so a collapsed or expanded item cannot widen or narrow the box it is
 * being measured against. Re-running after applying the result therefore
 * returns the same answer, and the state settles in one pass.
 *
 * The class is written straight onto the node inside a layout effect. That is
 * safe because both writes happen before paint and the node is handed back
 * carrying exactly the class it was rendered with, so nothing intermediate is
 * ever painted and React's own rendering never sees a class it did not put
 * there.
 */
export function useCollapseIfItAddsARow({
    rowRef,
    itemRef,
    collapsedClass,
    enabled = true,
    signature,
}: CollapseIfItAddsARowOptions): boolean {
    const [collapsed, setCollapsed] = useState(false)

    useLayoutEffect(() => {
        if (!enabled) return
        const row = rowRef.current
        const item = itemRef.current
        if (!row || !item) return

        const measure = () => {
            const rendered = item.classList.contains(collapsedClass)

            item.classList.add(collapsedClass)
            const rowsCollapsed = countRows(row)
            item.classList.remove(collapsedClass)
            const rowsExpanded = countRows(row)
            item.classList.toggle(collapsedClass, rendered)

            setCollapsed(rowsExpanded > rowsCollapsed)
        }

        measure()

        // A narrower row is the usual reason the answer changes. Guarded
        // because a non-browser environment may not define the observer, and
        // the item is expected to render there all the same.
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(row)
        return () => observer.disconnect()
        // signature stands for the row's contents, which the measurement reads
        // from the DOM and no other dependency here describes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, collapsedClass, signature, rowRef, itemRef])

    return enabled ? collapsed : false
}
