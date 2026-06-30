import { test, expect } from '@playwright/test'
import { getEnabledShareActions } from '../../../src/essence/Tools/ShareExport/lib/getEnabledShareActions.ts'

// Issue #144 - the format toggles must hide/show the right buttons. This helper
// is the single source of truth the panel renders from, so asserting on it
// proves the gating without a DOM render.

test.describe('getEnabledShareActions', () => {
    test('always includes the share link', () => {
        expect(getEnabledShareActions({ png: false, pdf: false })).toEqual([
            'link',
        ])
    })

    test('includes PNG and PDF when both enabled', () => {
        expect(getEnabledShareActions({ png: true, pdf: true })).toEqual([
            'link',
            'png',
            'pdf',
        ])
    })

    test('includes only the enabled download formats', () => {
        expect(getEnabledShareActions({ png: true, pdf: false })).toEqual([
            'link',
            'png',
        ])
        expect(getEnabledShareActions({ png: false, pdf: true })).toEqual([
            'link',
            'pdf',
        ])
    })
})
