import { test, expect } from 'vitest'
import { buildPreviewSrc } from '../../configure/src/core/upload.js'
import { resolveMissionAssetUrl } from '../../src/pre/uploadKey.ts'

// Pins the parts of the Configure CMS's stored-value-to-preview-URL
// resolution that the shared classifier table in
// tests/unit/uploadKeyClassifier.spec.js cannot express: empty input,
// absolute and data values passing through unchanged, an already-rooted
// non-upload value passing through unchanged, and — with an empty `base` —
// both resolved branches staying root-absolute. That last one matters
// because a preview URL names its root outright, so it points at the same
// file however deep the CMS is mounted.
test.describe('buildPreviewSrc', () => {
    test('returns empty string for empty input', () => {
        expect(buildPreviewSrc('', 'M', 'http://localhost:8888/')).toBe('')
    })

    test('a value that is not a string resolves to nothing', () => {
        // Stored values arrive as runtime configuration JSON, where a number
        // is as possible as a string.
        expect(buildPreviewSrc(42, 'M', 'http://localhost:8888/')).toBe('')
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
    // root-anchored URL, so it names the same file whatever path the CMS is
    // reached at. The rule both branches follow: an absent base stands in as
    // '/', never as the empty string.
    test('an empty base resolves a mission-relative value root-absolute', () => {
        const src = buildPreviewSrc('CardPlugin/uploads/a.png', 'M', '')
        expect(src).toBe('/Missions/M/CardPlugin/uploads/a.png')
    })

    test('a base missing its trailing slash is given one', () => {
        // getApiBase() hands over a trailing-slashed URL; a caller that
        // passes a bare prefix gets the same URL rather than
        // '/mmgisassets/…'.
        expect(
            buildPreviewSrc('assets/M/CardPlugin/uploads/x.png', 'M', '/mmgis'),
        ).toBe('/mmgis/assets/M/CardPlugin/uploads/x.png')
        expect(buildPreviewSrc('CardPlugin/uploads/a.png', 'M', '/mmgis')).toBe(
            '/mmgis/Missions/M/CardPlugin/uploads/a.png',
        )
    })
})

// The same non-table cases for the app bundle's resolver: what it does with a
// value that names no file, one that carries its own scheme, and one already
// anchored at the site root.
test.describe('resolveMissionAssetUrl', () => {
    const MISSION_PATH = 'Missions/M/'

    test('returns empty string for empty input', () => {
        expect(resolveMissionAssetUrl('', MISSION_PATH)).toBe('')
        expect(resolveMissionAssetUrl(undefined, MISSION_PATH)).toBe('')
        expect(resolveMissionAssetUrl(null, MISSION_PATH)).toBe('')
    })

    test('a value that is not a string resolves to nothing', () => {
        // The declared parameter type describes the caller's intent; what
        // actually arrives is runtime configuration JSON.
        expect(resolveMissionAssetUrl(42, MISSION_PATH)).toBe('')
    })

    test('passes through absolute and data values unchanged', () => {
        expect(resolveMissionAssetUrl('https://x/y.png', MISSION_PATH)).toBe(
            'https://x/y.png',
        )
        expect(
            resolveMissionAssetUrl('data:image/png;base64,AAAA', MISSION_PATH),
        ).toBe('data:image/png;base64,AAAA')
    })

    test('an already-rooted value that is not an upload key passes through unchanged', () => {
        expect(resolveMissionAssetUrl('/already/rooted.png', MISSION_PATH)).toBe(
            '/already/rooted.png',
        )
    })

    test('an absent mission path leaves a mission-relative value as it came', () => {
        // Callers resolve before the mission path is known, so a null path
        // yields the stored value rather than a URL anchored nowhere.
        expect(resolveMissionAssetUrl('Sub/uploads/x.png', null)).toBe(
            'Sub/uploads/x.png',
        )
    })
})
