/**
 * Public types for the portable Comparison library.
 *
 * This directory is MMGIS-agnostic: it must not import map internals, layer
 * managers, jQuery, the event bus, or any other MMGIS global. All coupling to
 * MMGIS lives in ../adapters and ../MMGISComparisonAdapter.tsx.
 */

/** Which comparison the panel is configured for. */
export type ComparisonMode = 'layers' | 'dates'

/**
 * How the two sides share the map.
 *
 * - `'swipe'` — one view with a divider wiping between the two layers, so a
 *   place is seen under one layer or the other.
 * - `'sideBySide'` — two panes meeting at the divider, locked to the same
 *   centre and zoom, so a place is seen under both layers at once.
 */
export type ComparisonLayout = 'swipe' | 'sideBySide'

/**
 * How far the host has got in answering "does this map have a timeline?".
 * `'loading'` is a host still reading it, `'unavailable'` a map that has none.
 */
export type TimeStatus = 'loading' | 'ready' | 'unavailable'

/** A selectable layer shown in the side dropdowns. */
export type LayerOption = {
    /** Stable layer id (MMGIS layer name). */
    id: string
    /** Human-readable label for the dropdown. */
    title: string
}
