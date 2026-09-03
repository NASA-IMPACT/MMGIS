import { test, expect } from 'vitest'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'

// Pins the Configure CMS's stored-value-to-preview-URL resolution: absolute
// and data values pass through unchanged. Values matching the lean-mode
// upload writer's own shape ("assets/<mission>/<subdir>/uploads/<file>", see
// API/Backend/Upload/uploadRouter.js) resolve against `base` (root-absolute
// when `base` is empty — the CMS is always server-hosted); a rooted
// "/assets/..." value is the same key with a leading slash, stripped before
// the test. Any other already-rooted value passes through unchanged; everything
// else is a mission-relative path resolved under Missions/ — root-anchored
// the same way, so the preview URL does not resolve against whatever path
// the CMS happens to be visited at.
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
        // Starts with "/assets/" but carries no "/uploads/" segment, so it
        // is not the writer's shape — stays root-relative, unresolved.
        expect(
            buildPreviewSrc('/assets/M/x.png', 'M', 'http://localhost:8888/'),
        ).toBe('/assets/M/x.png')
    })

    test('resolves an assets/ upload value against the API base', () => {
        expect(
            buildPreviewSrc(
                'assets/M/CardPlugin/uploads/x.png',
                'M',
                'http://localhost:8888/',
            ),
        ).toBe('http://localhost:8888/assets/M/CardPlugin/uploads/x.png')
    })

    test('an empty base resolves an assets/ upload value root-absolute', () => {
        expect(
            buildPreviewSrc('assets/M/CardPlugin/uploads/x.png', 'M', ''),
        ).toBe('/assets/M/CardPlugin/uploads/x.png')
    })

    test('a non-empty base rebases a rooted /assets/ upload value', () => {
        expect(
            buildPreviewSrc(
                '/assets/M/CardPlugin/uploads/x.png',
                'M',
                '/mmgis/',
            ),
        ).toBe('/mmgis/assets/M/CardPlugin/uploads/x.png')
    })

    test('resolves mission-relative values under Missions/<mission>/', () => {
        expect(
            buildPreviewSrc('CardPlugin/uploads/a.png', 'M', '/mmgis/'),
        ).toBe('/mmgis/Missions/M/CardPlugin/uploads/a.png')
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
