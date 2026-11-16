// The comparison as a share link carries it. The link's `tools=` entry is a
// comma-separated list the core splits before any tool sees its part, so the
// encoding uses '|' between fields and holds no commas: layer ids are UUIDs
// and dates are ISO instants.
import type { ComparisonLayout, ComparisonMode } from '../lib/types'

export type ComparisonUrlState = {
    mode: ComparisonMode
    layout: ComparisonLayout
    /** The layer picked for each side in layers mode, before any swap. */
    leftLayerId: string | null
    rightLayerId: string | null
    /** The second date in dates mode, as an ISO instant. */
    compareDate: string | null
    swapped: boolean
    /** Where the divider sits, 0..1. */
    dividerPos: number
}

const MODES: ComparisonMode[] = ['layers', 'dates']
const LAYOUTS: ComparisonLayout[] = ['swipe', 'sideBySide']
const SEPARATOR = '|'

const field = (value: string | null): string => (value ?? '').replace(/[|,]/g, '')

export const encodeComparisonUrlState = (state: ComparisonUrlState): string =>
    [
        state.mode,
        state.layout,
        field(state.leftLayerId),
        field(state.rightLayerId),
        field(state.compareDate),
        state.swapped ? '1' : '0',
        Math.max(0, Math.min(1, state.dividerPos)).toFixed(2),
    ].join(SEPARATOR)

/** The state a link carries, or null for text that is not one of ours. */
export const decodeComparisonUrlState = (text: string | null | undefined): ComparisonUrlState | null => {
    if (typeof text !== 'string') return null
    const parts = text.split(SEPARATOR)
    if (parts.length !== 7) return null
    const [mode, layout, left, right, date, swapped, pos] = parts
    if (!MODES.includes(mode as ComparisonMode)) return null
    if (!LAYOUTS.includes(layout as ComparisonLayout)) return null
    const dividerPos = Number(pos)
    if (!Number.isFinite(dividerPos) || dividerPos < 0 || dividerPos > 1) return null
    if (date && Number.isNaN(Date.parse(date))) return null
    return {
        mode: mode as ComparisonMode,
        layout: layout as ComparisonLayout,
        leftLayerId: left || null,
        rightLayerId: right || null,
        compareDate: date || null,
        swapped: swapped === '1',
        dividerPos,
    }
}
