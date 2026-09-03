import { test, expect } from 'vitest'
import {
    resolveImageUrl,
    resolveLinkUrl,
    buildCardData,
} from '../../../src/essence/Tools/Card/adapters/buildCardData.ts'

test.describe('resolveImageUrl', () => {
    test('returns empty string for empty input', () => {
        expect(resolveImageUrl('', 'Missions/MSL/')).toBe('')
        expect(resolveImageUrl(undefined, 'Missions/MSL/')).toBe('')
    })

    test('passes through absolute and data URLs', () => {
        expect(resolveImageUrl('https://x/y.png', 'Missions/MSL/')).toBe(
            'https://x/y.png',
        )
        expect(resolveImageUrl('http://x/y.png', 'Missions/MSL/')).toBe(
            'http://x/y.png',
        )
        expect(
            resolveImageUrl('data:image/png;base64,AAAA', 'Missions/MSL/'),
        ).toBe('data:image/png;base64,AAAA')
    })

    test('an already-rooted value that is not an upload shape passes through unchanged', () => {
        expect(resolveImageUrl('/already/rooted.png', 'Missions/MSL/')).toBe(
            '/already/rooted.png',
        )
    })

    test('prefixes mission-relative paths with the mission path', () => {
        expect(
            resolveImageUrl('CardPlugin/uploads/a.png', 'Missions/MSL/'),
        ).toBe('Missions/MSL/CardPlugin/uploads/a.png')
    })

    test('tolerates a null mission path', () => {
        expect(resolveImageUrl('CardPlugin/uploads/a.png', null)).toBe(
            'CardPlugin/uploads/a.png',
        )
    })

    test('leaves dashboard-root-relative assets/ paths unprefixed', () => {
        expect(
            resolveImageUrl(
                'assets/M/CardPlugin/uploads/a.png',
                'Missions/M/',
            ),
        ).toBe('assets/M/CardPlugin/uploads/a.png')
    })

    test('rebases rooted /assets/ paths to the dashboard-relative form', () => {
        expect(
            resolveImageUrl(
                '/assets/M/CardPlugin/uploads/a.png',
                'Missions/M/',
            ),
        ).toBe('assets/M/CardPlugin/uploads/a.png')
    })
})

test.describe('buildCardData', () => {
    test('returns empty array for missing/invalid input', () => {
        expect(buildCardData(undefined, 'Missions/MSL/')).toEqual([])
        // @ts-expect-error exercising defensive non-array input
        expect(buildCardData(null, 'Missions/MSL/')).toEqual([])
    })

    test('maps raw cards to renderable items with resolved image URLs', () => {
        const out = buildCardData(
            [
                {
                    image: 'CardPlugin/uploads/a.png',
                    title: 'T',
                    subtitle: 'S',
                    linkUrl: 'https://x',
                },
            ],
            'Missions/MSL/',
        )
        expect(out).toEqual([
            {
                imageUrl: 'Missions/MSL/CardPlugin/uploads/a.png',
                title: 'T',
                subtitle: 'S',
                linkUrl: 'https://x',
            },
        ])
    })
})

test.describe('resolveLinkUrl', () => {
    test('returns undefined for empty/blank input', () => {
        expect(resolveLinkUrl('')).toBeUndefined()
        expect(resolveLinkUrl('   ')).toBeUndefined()
        expect(resolveLinkUrl(undefined)).toBeUndefined()
        expect(resolveLinkUrl(null)).toBeUndefined()
    })

    test('prepends https:// to scheme-less external links', () => {
        expect(resolveLinkUrl('www.google.com')).toBe('https://www.google.com')
        expect(resolveLinkUrl('bass.codebycarson.com')).toBe(
            'https://bass.codebycarson.com',
        )
        expect(resolveLinkUrl('  example.com/path  ')).toBe(
            'https://example.com/path',
        )
    })

    test('passes through absolute http(s) and internal links', () => {
        expect(resolveLinkUrl('https://x.com')).toBe('https://x.com')
        expect(resolveLinkUrl('http://x.com')).toBe('http://x.com')
        expect(resolveLinkUrl('/internal/path')).toBe('/internal/path')
        expect(resolveLinkUrl('//cdn.x.com/a')).toBe('//cdn.x.com/a')
    })

    test('rejects unsafe or non-http(s) schemes', () => {
        expect(resolveLinkUrl('javascript:alert(1)')).toBeUndefined()
        expect(resolveLinkUrl('data:text/html,<script>')).toBeUndefined()
        expect(resolveLinkUrl('mailto:a@b.com')).toBeUndefined()
        expect(resolveLinkUrl('tel:+15551234')).toBeUndefined()
        expect(resolveLinkUrl('ftp://x.com')).toBeUndefined()
    })

    test('rejects scheme-less bare words with no dotted host', () => {
        expect(resolveLinkUrl('arst')).toBeUndefined()
        expect(resolveLinkUrl('notaurl')).toBeUndefined()
    })
})
