import { test, expect } from 'vitest'
import {
    resolveShareFormats,
    resolveIncludeLegend,
} from '../../../src/essence/Tools/ShareExport/adapters/shareConfig.ts'

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

test.describe('resolveIncludeLegend', () => {
    test('defaults on when no vars are set', () => {
        expect(resolveIncludeLegend(undefined)).toBe(true)
        expect(resolveIncludeLegend(null)).toBe(true)
        expect(resolveIncludeLegend({})).toBe(true)
    })

    test('treats an explicit true as enabled', () => {
        expect(resolveIncludeLegend({ includeLegend: true })).toBe(true)
    })

    test('disables only when explicitly set to false', () => {
        expect(resolveIncludeLegend({ includeLegend: false })).toBe(false)
    })
})
