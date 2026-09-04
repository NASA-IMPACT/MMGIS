import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'

// Pins the Configure CMS's stored-value-to-preview-URL resolution: absolute
// and data values pass through unchanged. Values matching the lean-mode
// upload writer's own shape ("assets/<mission>/<subdir>/uploads/<file>", see
// API/Backend/Upload/uploadRouter.js) resolve against `base` (root-absolute
// when `base` is empty — the CMS is always server-hosted); a legacy rooted
// "/assets/..." value is rebased to that same slash-less shape before the
// test. Any other already-rooted value passes through unchanged; everything
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

    test('a non-empty base rebases a legacy rooted /assets/ upload value', () => {
        expect(
            buildPreviewSrc(
                '/assets/M/CardPlugin/uploads/x.png',
                'M',
                '/mmgis/',
            ),
        ).toBe('/mmgis/assets/M/CardPlugin/uploads/x.png')
    })

    // The upload-key classifier negatives (assets/ without /uploads/,
    // case-sensitivity, the "assets/uploads/x.png" lookalike) are exercised
    // in tests/unit/Card/resolveImageUrl.spec.js. The ASSETS_UPLOAD_KEY sync
    // test below proves both bundles' classifier regexes are byte-identical,
    // so those negatives hold for buildPreviewSrc too without duplicating them.

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

// The upload-key classifier is necessarily duplicated: the Card tool ships in
// the app bundle and buildPreviewSrc ships in the Configure SPA, so the two
// cannot share a module. They must still agree on what an upload key looks
// like — a value the CMS previews as an upload but the Card tool
// mission-prefixes (or vice versa) renders a broken image only at runtime.
// This reads both sources as text and fails CI the moment the literals drift.
// It pins the CLASSIFIER only: what the two consumers then DO with a matched
// key deliberately differs (the Card tool returns it document-relative, the
// CMS prefixes it with its own base), so agreement of resolution is not
// covered.
test.describe('ASSETS_UPLOAD_KEY stays identical across both bundles', () => {
    const SOURCES = [
        'configure/src/core/upload.js',
        'src/pre/uploadKey.ts',
    ]

    test('both sources declare the same regex literal', () => {
        const literals = SOURCES.map((relative) => {
            const source = fs.readFileSync(
                path.join(__dirname, '../..', relative),
                'utf8',
            )
            const match = /const ASSETS_UPLOAD_KEY\s*=\s*(\/.+\/[a-z]*);?\s*$/m.exec(
                source,
            )
            expect(match, `${relative} declares ASSETS_UPLOAD_KEY`).toBeTruthy()
            return match[1]
        })
        expect(literals[1]).toBe(literals[0])
    })
})
