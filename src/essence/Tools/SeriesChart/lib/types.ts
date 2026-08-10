// Presentation-side state for the SeriesChart panel. Framework-agnostic — the
// only import is the shared series contract (types only).

import type { ChartSeriesPayload } from '../../_shared/types/chartSeries'

export type CardState =
    | { status: 'loading'; title?: string }
    | { status: 'ready'; payload: ChartSeriesPayload }
    | { status: 'error'; title?: string; message: string }

export interface ChartCard {
    chartId: string
    state: CardState
}

/** Colors resolved from the page theme (CSS custom properties). */
export interface ChartTheme {
    /** Series colors, cycled when a series declares no color of its own. */
    palette: string[]
    gridColor: string
    textColor: string
    /** Card/panel surface color (--theme-color-white). */
    surface: string
}
