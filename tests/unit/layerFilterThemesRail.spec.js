import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
    normalizeRailThemes,
    resolveInitialThemeId,
} from '../../src/essence/Tools/LayerFilterThemes/lib/normalizeThemes.ts'

describe('LayerFilterThemes normalizeRailThemes', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('reads an uploaded icon when that is the chosen source', () => {
        expect(
            normalizeRailThemes([
                {
                    id: 'need',
                    label: 'Need',
                    iconSource: 'upload',
                    iconUpload: 'LayerFilterThemes/uploads/abc.svg',
                    iconMdi: 'satellite-variant',
                },
            ]),
        ).toEqual([
            {
                id: 'need',
                label: 'Need',
                icon: {
                    kind: 'image',
                    src: 'LayerFilterThemes/uploads/abc.svg',
                },
            },
        ])
    })

    test('reads a linked icon when that is the chosen source', () => {
        expect(
            normalizeRailThemes([
                {
                    id: 'need',
                    label: 'Need',
                    iconSource: 'link',
                    iconUrl: 'https://example.test/need.svg',
                },
            ]),
        ).toEqual([
            {
                id: 'need',
                label: 'Need',
                icon: { kind: 'image', src: 'https://example.test/need.svg' },
            },
        ])
    })

    test('reads an MDI name when that is the chosen source', () => {
        expect(
            normalizeRailThemes([
                {
                    id: 'need',
                    label: 'Need',
                    iconSource: 'mdi',
                    iconMdi: 'satellite-variant',
                },
            ]),
        ).toEqual([
            {
                id: 'need',
                label: 'Need',
                icon: { kind: 'mdi', name: 'satellite-variant' },
            },
        ])
    })

    test('falls back to whichever icon field is filled when the chosen source is empty', () => {
        expect(
            normalizeRailThemes([
                {
                    id: 'need',
                    label: 'Need',
                    iconSource: 'upload',
                    iconMdi: 'satellite-variant',
                },
            ]),
        ).toEqual([
            {
                id: 'need',
                label: 'Need',
                icon: { kind: 'mdi', name: 'satellite-variant' },
            },
        ])
        expect(console.warn).not.toHaveBeenCalled()
    })

    test('warns when a chosen source has no icon to fall back on', () => {
        expect(
            normalizeRailThemes([
                { id: 'need', label: 'Need', iconSource: 'upload' },
            ]),
        ).toEqual([{ id: 'need', label: 'Need' }])
        expect(console.warn).toHaveBeenCalledTimes(1)
    })

    test('a bare icon string from an older config still resolves', () => {
        expect(
            normalizeRailThemes([
                { id: 'need', label: 'Need', icon: 'satellite-variant' },
            ]),
        ).toEqual([
            {
                id: 'need',
                label: 'Need',
                icon: { kind: 'mdi', name: 'satellite-variant' },
            },
        ])
        expect(
            normalizeRailThemes([
                { id: 'a', label: 'A', icon: 'LayerFilterThemes/uploads/a.svg' },
            ]),
        ).toEqual([
            {
                id: 'a',
                label: 'A',
                icon: { kind: 'image', src: 'LayerFilterThemes/uploads/a.svg' },
            },
        ])
    })

    test('label falls back to the id so the rail is never blank', () => {
        expect(normalizeRailThemes([{ id: 'hazard' }])).toEqual([
            { id: 'hazard', label: 'hazard' },
        ])
    })

    test('drops entries with no usable id', () => {
        expect(
            normalizeRailThemes([{ label: 'Orphan' }, { id: '', label: 'Empty' }]),
        ).toEqual([])
        expect(console.warn).toHaveBeenCalledTimes(2)
    })

    test('drops a duplicate id rather than rendering two identical tabs', () => {
        expect(
            normalizeRailThemes([
                { id: 'need', label: 'Need' },
                { id: 'need', label: 'Need Again' },
            ]),
        ).toEqual([{ id: 'need', label: 'Need' }])
        expect(console.warn).toHaveBeenCalledTimes(1)
    })

    test('omits a non-string or empty icon instead of emitting mdi-undefined', () => {
        expect(normalizeRailThemes([{ id: 'a', label: 'A', icon: 7 }])).toEqual([
            { id: 'a', label: 'A' },
        ])
        expect(normalizeRailThemes([{ id: 'b', label: 'B', icon: '' }])).toEqual([
            { id: 'b', label: 'B' },
        ])
        expect(
            normalizeRailThemes([{ id: 'c', label: 'C', iconMdi: '   ' }]),
        ).toEqual([{ id: 'c', label: 'C' }])
    })

    test('a non-array config yields an empty rail with a warning', () => {
        expect(normalizeRailThemes({ need: 'Need' })).toEqual([])
        expect(console.warn).toHaveBeenCalledTimes(1)
    })

    test('an absent config yields an empty rail without warning', () => {
        expect(normalizeRailThemes(undefined)).toEqual([])
        expect(console.warn).not.toHaveBeenCalled()
    })
})

describe('LayerFilterThemes resolveInitialThemeId', () => {
    const themes = [
        { id: 'need', label: 'Need' },
        { id: 'hazard', label: 'Hazard' },
    ]

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('uses the configured default when it names a real theme', () => {
        expect(resolveInitialThemeId(themes, 'hazard')).toBe('hazard')
    })

    test('falls back to the first theme when no default is configured', () => {
        expect(resolveInitialThemeId(themes, undefined)).toBe('need')
    })

    test('warns and falls back when the configured default matches nothing', () => {
        expect(resolveInitialThemeId(themes, 'nope')).toBe('need')
        expect(console.warn).toHaveBeenCalledTimes(1)
    })

    test('returns null when there are no themes to select', () => {
        expect(resolveInitialThemeId([], 'need')).toBeNull()
    })
})
