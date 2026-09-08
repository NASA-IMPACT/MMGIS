import { test, expect } from 'vitest'
import { resolveShareFormats } from '../../../src/essence/Tools/ShareExport/adapters/shareConfig.ts'

// Issue #144 - the share link is always available; PNG and PDF are each
// toggleable per-dashboard and default to ON when unset.

test.describe('resolveShareFormats', () => {
    test('defaults both PNG and PDF on when no vars are set', () => {
        expect(resolveShareFormats(undefined)).toEqual({ png: true, pdf: true })
        expect(resolveShareFormats(null)).toEqual({ png: true, pdf: true })
        expect(resolveShareFormats({})).toEqual({ png: true, pdf: true })
    })

    test('treats an explicit true as enabled', () => {
        expect(resolveShareFormats({ exportPng: true, exportPdf: true })).toEqual(
            { png: true, pdf: true },
        )
    })

    test('disables only the format toggled off', () => {
        expect(resolveShareFormats({ exportPng: false })).toEqual({
            png: false,
            pdf: true,
        })
        expect(resolveShareFormats({ exportPdf: false })).toEqual({
            png: true,
            pdf: false,
        })
        expect(
            resolveShareFormats({ exportPng: false, exportPdf: false }),
        ).toEqual({ png: false, pdf: false })
    })
})

// includeLegend resolution moved to _shared/share/resolveIncludeLegend,
// shared with the MapControl adapter — see that module's own spec.
