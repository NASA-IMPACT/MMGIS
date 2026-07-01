import { test, expect } from 'vitest'
import { getShareMenuItems } from '../../../src/essence/Tools/ShareExport/lib/getShareMenuItems.ts'

// Issue #144 - the redesigned Share control is a top-right "Share map" trigger
// that opens a compact dropdown. getShareMenuItems is the single source of truth
// the dropdown renders from, so asserting on it proves (a) the config toggles
// gate which items appear and (b) each item is wired to the matching handler —
// all with injected/mocked handlers and no DOM, mirroring the other specs.

function mockHandlers() {
    const calls = []
    return {
        calls,
        onCopyLink: () => calls.push('copy'),
        onDownloadPng: () => calls.push('png'),
        onDownloadPdf: () => calls.push('pdf'),
    }
}

test.describe('getShareMenuItems gating', () => {
    test('always includes the copy-link item', () => {
        const items = getShareMenuItems({ png: false, pdf: false }, mockHandlers())
        expect(items.map((i) => i.kind)).toEqual(['link'])
        expect(items[0].label).toBe('Copy link to view')
    })

    test('includes link + both exports when enabled', () => {
        const items = getShareMenuItems({ png: true, pdf: true }, mockHandlers())
        expect(items.map((i) => i.kind)).toEqual(['link', 'png', 'pdf'])
        expect(items.map((i) => i.label)).toEqual([
            'Copy link to view',
            'Export as PNG',
            'Export as PDF',
        ])
    })

    test('hides the export item whose toggle is off', () => {
        expect(
            getShareMenuItems({ png: true, pdf: false }, mockHandlers()).map(
                (i) => i.kind,
            ),
        ).toEqual(['link', 'png'])
        expect(
            getShareMenuItems({ png: false, pdf: true }, mockHandlers()).map(
                (i) => i.kind,
            ),
        ).toEqual(['link', 'pdf'])
    })

    test('separates the link from the downloads with one divider', () => {
        const both = getShareMenuItems({ png: true, pdf: true }, mockHandlers())
        // Only the first export item carries the leading separator.
        expect(both.filter((i) => i.separatorBefore).map((i) => i.kind)).toEqual([
            'png',
        ])

        const linkOnly = getShareMenuItems(
            { png: false, pdf: false },
            mockHandlers(),
        )
        expect(linkOnly.some((i) => i.separatorBefore)).toBe(false)

        // With PNG off, the divider moves to the first remaining export (PDF).
        const pdfOnly = getShareMenuItems(
            { png: false, pdf: true },
            mockHandlers(),
        )
        expect(pdfOnly.filter((i) => i.separatorBefore).map((i) => i.kind)).toEqual(
            ['pdf'],
        )
    })

    test('only the export items are gated by the busy flag', () => {
        const items = getShareMenuItems({ png: true, pdf: true }, mockHandlers())
        const byKind = Object.fromEntries(items.map((i) => [i.kind, i.gatedByBusy]))
        expect(byKind).toEqual({ link: false, png: true, pdf: true })
    })
})

test.describe('getShareMenuItems handler wiring', () => {
    test('each item fires its matching action handler', () => {
        const h = mockHandlers()
        const items = getShareMenuItems({ png: true, pdf: true }, h)
        items.find((i) => i.kind === 'link').onClick()
        items.find((i) => i.kind === 'png').onClick()
        items.find((i) => i.kind === 'pdf').onClick()
        expect(h.calls).toEqual(['copy', 'png', 'pdf'])
    })

    test('the link item never invokes an export handler', () => {
        const h = mockHandlers()
        const items = getShareMenuItems({ png: false, pdf: false }, h)
        items[0].onClick()
        expect(h.calls).toEqual(['copy'])
    })
})
