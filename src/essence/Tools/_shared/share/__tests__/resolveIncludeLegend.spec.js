import { test, expect } from 'vitest'
import { resolveIncludeLegend } from '../resolveIncludeLegend.ts'

// Shared by two consumers — MMGISShareExportAdapter.tsx and
// MMGISMapControlAdapter.tsx both toggle the export legend band through this
// one function, so a single suite here covers both call sites.

test('the legend band is on until a mission turns it off', () => {
    expect(resolveIncludeLegend(undefined)).toBe(true)
    expect(resolveIncludeLegend({})).toBe(true)
    expect(resolveIncludeLegend({ includeLegend: true })).toBe(true)
})

// Configure persists an unchecked checkbox in whichever of these forms the
// field happens to use; miss one and a saved 'false' leaves the band on.
test('every form Configure persists an unchecked box as turns it off', () => {
    expect(resolveIncludeLegend({ includeLegend: false })).toBe(false)
    expect(resolveIncludeLegend({ includeLegend: 'false' })).toBe(false)
    expect(resolveIncludeLegend({ includeLegend: 0 })).toBe(false)
    expect(resolveIncludeLegend({ includeLegend: '0' })).toBe(false)
})
