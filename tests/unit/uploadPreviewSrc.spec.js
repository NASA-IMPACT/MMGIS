import { test, expect } from 'vitest'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'

// Pins the parts of the Configure CMS's stored-value-to-preview-URL
// resolution that the shared classifier table in
// tests/unit/uploadKeyClassifier.spec.js cannot express: empty input,
// absolute and data values passing through unchanged, an already-rooted
// non-upload value passing through unchanged, and — with an empty `base` —
// both resolved branches staying root-absolute. That last one matters
// because the SPA is served at '/configure/', so a document-relative preview
// URL would resolve against that path and 404.
test.describe('buildPreviewSrc', () => {
    test('returns empty string for empty input', () => {
        expect(buildPreviewSrc('', 'M', 'http://localhost:8888/')).toBe('')
    })

    test('passes through absolute and data values unchanged', () => {
        expect(
            buildPreviewSrc('https://x/y.png', 'M', 'http://localhost:8888/'),
        ).toBe('https://x/y.png')
        expect(
            buildPreviewSrc(
                'data:image/png;base64,AAAA',
                'M',
                'http://localhost:8888/',
            ),
        ).toBe('data:image/png;base64,AAAA')
    })

    test('an already-rooted value that is not an upload shape passes through unchanged', () => {
        expect(
            buildPreviewSrc(
                '/already/rooted.png',
                'M',
                'http://localhost:8888/',
            ),
        ).toBe('/already/rooted.png')
    })

    test('an empty base resolves an assets/ upload value root-absolute', () => {
        expect(
            buildPreviewSrc('assets/M/CardPlugin/uploads/x.png', 'M', ''),
        ).toBe('/assets/M/CardPlugin/uploads/x.png')
    })

    // With no ROOT_PATH base the mission-relative branch must still produce a
    // root-anchored URL: a document-relative "Missions/…" would resolve
    // against the CMS's own path (the SPA is served at '/configure/') and
    // 404. The exact root-absolute value below catches a regression to
    // `base || ''`.
    test('an empty base resolves a mission-relative value root-absolute', () => {
        const src = buildPreviewSrc('CardPlugin/uploads/a.png', 'M', '')
        expect(src).toBe('/Missions/M/CardPlugin/uploads/a.png')
    })
})
