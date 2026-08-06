import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Placement is expressed against whichever edge the surface is aligned to. */
export type AnchoredPosition = { left: number; top?: number; bottom?: number }

type Options = {
    /** Width of the anchored surface, used to keep it inside the viewport. */
    width: number
    /** Tallest the surface can get, used to decide whether it opens upward. */
    maxHeight: number
    /** Gap between the anchor and the surface. */
    gap?: number
    /** Distance the surface keeps from the viewport edges. */
    margin?: number
    /** Called when the anchor is no longer visible enough to point at. */
    onAnchorLost?: () => void
}

const samePosition = (a: AnchoredPosition | null, b: AnchoredPosition): boolean =>
    a != null && a.left === b.left && a.top === b.top && a.bottom === b.bottom

/**
 * Viewport coordinates for a surface anchored to an element.
 *
 * The layer list clips its overflow, so a dropdown tall enough to overhang the
 * panel has to render in a portal positioned against the viewport instead of
 * flowing inside the row. That trades away the browser's automatic
 * repositioning, so this recomputes on scroll — capture phase, since the
 * scrolling element is the layer list rather than the window — and on resize.
 */
export const useAnchoredPosition = (
    anchorRef: RefObject<HTMLElement | null>,
    open: boolean,
    { width, maxHeight, gap = 6, margin = 8, onAnchorLost }: Options,
): AnchoredPosition | null => {
    const [position, setPosition] = useState<AnchoredPosition | null>(null)

    const measure = useCallback(() => {
        const anchor = anchorRef.current
        if (!anchor) return
        const rect = anchor.getBoundingClientRect()

        // A surface still pinned to the viewport after its row has scrolled
        // away would point at nothing, so give up the anchor instead.
        const anchorVisible = rect.bottom > 0 && rect.top < window.innerHeight
        if (!anchorVisible) {
            onAnchorLost?.()
            return
        }

        const maxLeft = Math.max(margin, window.innerWidth - width - margin)
        const left = Math.min(Math.max(margin, rect.left), maxLeft)

        // Prefer opening downward; flip above the anchor only when the surface
        // would run off the bottom and there is more room above it. Opening
        // upward pins the surface's bottom edge to the anchor, so a surface
        // shorter than its maximum still sits against the button.
        const spaceBelow = window.innerHeight - rect.bottom - gap - margin
        const spaceAbove = rect.top - gap - margin
        const next: AnchoredPosition =
            spaceBelow < maxHeight && spaceAbove > spaceBelow
                ? { left, bottom: Math.max(margin, window.innerHeight - rect.top + gap) }
                : { left, top: Math.max(margin, rect.bottom + gap) }

        // Scroll fires far more often than the anchor actually moves, and each
        // committed position re-renders the whole surface beneath it.
        setPosition((current) => (samePosition(current, next) ? current : next))
    }, [anchorRef, width, maxHeight, gap, margin, onAnchorLost])

    // Measure before paint so the surface never renders at a stale position.
    useLayoutEffect(() => {
        if (!open) {
            setPosition(null)
            return
        }
        measure()
    }, [open, measure])

    useEffect(() => {
        if (!open) return
        window.addEventListener('scroll', measure, true)
        window.addEventListener('resize', measure)
        return () => {
            window.removeEventListener('scroll', measure, true)
            window.removeEventListener('resize', measure)
        }
    }, [open, measure])

    return position
}
