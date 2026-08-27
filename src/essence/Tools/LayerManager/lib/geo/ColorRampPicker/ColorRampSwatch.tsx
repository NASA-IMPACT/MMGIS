import React from 'react'
import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { useColormapColors } from '../../hooks/useColormapColors'
import { buildGradientCss, formatColormapLabel } from '../../utils/colormaps'

export type ColorRampSwatchProps = {
    /** Forward ramp name; direction comes from `reversed`. */
    name: string
    reversed: boolean
    selected: boolean
    titilerUrl?: string | null
    /** Ramps the app can paint itself; these resolve without a request. */
    localColormaps?: Record<string, string[]> | null
    /** Scroll container the visibility check measures against. */
    rootRef: RefObject<HTMLElement | null>
    onSelect: (name: string) => void
}

/**
 * One selectable ramp, previewed as the gradient it produces.
 *
 * Every swatch costs a request for its color definition, and the service
 * offers upwards of a hundred ramps, so a row resolves its colors only once it
 * scrolls into view. Having appeared, it stays resolved — scrolling back over
 * a row should not make it flicker through a loading state again.
 */
function ColorRampSwatchComponent({
    name,
    reversed,
    selected,
    titilerUrl,
    localColormaps,
    rootRef,
    onSelect,
}: ColorRampSwatchProps) {
    const rowRef = useRef<HTMLButtonElement | null>(null)
    const [hasAppeared, setHasAppeared] = useState(
        () => typeof IntersectionObserver === 'undefined',
    )

    useEffect(() => {
        if (hasAppeared) return
        const row = rowRef.current
        if (!row) return
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setHasAppeared(true)
                    observer.disconnect()
                }
            },
            // Resolve a screenful ahead of the scroll so swatches are painted
            // by the time they arrive.
            { root: rootRef.current, rootMargin: '200px 0px' },
        )
        observer.observe(row)
        return () => observer.disconnect()
    }, [hasAppeared, rootRef])

    const { colors } = useColormapColors(
        name,
        reversed,
        titilerUrl,
        hasAppeared,
        localColormaps,
    )

    return (
        <button
            ref={rowRef}
            type="button"
            aria-pressed={selected}
            className={`blocks-color-ramp-picker__ramp ${
                selected ? 'blocks-color-ramp-picker__ramp--selected' : ''
            }`}
            onClick={() => onSelect(name)}
        >
            <span
                aria-hidden="true"
                className="blocks-color-ramp-picker__swatch"
                style={colors ? { background: buildGradientCss(colors) } : undefined}
            />
            <span className="blocks-color-ramp-picker__ramp-name">
                {formatColormapLabel(name)}
            </span>
        </button>
    )
}

// Repositioning the surface re-renders the whole list, and rebuilding a
// 256-stop gradient string per row makes that cost real.
export const ColorRampSwatch = memo(ColorRampSwatchComponent)
