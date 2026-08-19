import { test, expect } from 'vitest'
import { resolveIncludeLegend } from '../resolveIncludeLegend.ts'

// Shared by two consumers — MMGISShareExportAdapter.tsx and
// MMGISMapControlAdapter.tsx both toggle the export legend band through this
// one function, so a single suite here covers both call sites. Before this
// fix, ShareExport used `!== false` while MapControl used a wider falsy set;
// unifying on the wider set means a Configure-persisted 'false'/0/'0' string
// disables the band in both places.

test.describe('resolveIncludeLegend', () => {
    test('defaults on when no vars are set', () => {
        expect(resolveIncludeLegend(undefined)).toBe(true)
        expect(resolveIncludeLegend(null)).toBe(true)
        expect(resolveIncludeLegend({})).toBe(true)
    })

    test('treats an explicit true as enabled', () => {
        expect(resolveIncludeLegend({ includeLegend: true })).toBe(true)
    })

    test('disables on a real boolean false', () => {
        expect(resolveIncludeLegend({ includeLegend: false })).toBe(false)
    })

    test('disables on the string/number forms Configure can persist', () => {
        expect(resolveIncludeLegend({ includeLegend: 'false' })).toBe(false)
        expect(resolveIncludeLegend({ includeLegend: 0 })).toBe(false)
        expect(resolveIncludeLegend({ includeLegend: '0' })).toBe(false)
    })

    test('a truthy non-boolean value (e.g. "true") stays enabled', () => {
        expect(resolveIncludeLegend({ includeLegend: 'true' })).toBe(true)
        expect(resolveIncludeLegend({ includeLegend: 1 })).toBe(true)
    })
})
