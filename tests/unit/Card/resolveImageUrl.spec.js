import { test, expect } from '@playwright/test'
import {
    resolveImageUrl,
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
