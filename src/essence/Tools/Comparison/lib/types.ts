/**
 * Public types for the portable Comparison library.
 *
 * This directory is MMGIS-agnostic: it must not import map internals, layer
 * managers, jQuery, the event bus, or any other MMGIS global. All coupling to
 * MMGIS lives in ../adapters and ../MMGISComparisonAdapter.tsx.
 */

/** Which comparison the panel is configured for. */
export type ComparisonMode = 'layers' | 'dates'

/** A selectable layer shown in the side dropdowns. */
export type LayerOption = {
    /** Stable layer id (MMGIS layer name). */
    id: string
    /** Human-readable label for the dropdown. */
    title: string
}
