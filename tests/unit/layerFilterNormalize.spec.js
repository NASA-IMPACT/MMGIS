import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    normalizeThemesConfig,
    resolveDefaultThemeId,
} from '../../src/essence/Tools/LayerFilter/lib/normalizeConfig.ts'

const theme = (over = {}) => ({
    id: 'need',
    label: 'Need',
    title: 'Need',
    filters: [{ id: 'sector', label: 'Sector', property: 'sector', type: 'select' }],
    ...over,
})

let warn
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('normalizeThemesConfig', () => {
    test('passes a valid config through unchanged, no warnings', () => {
        const input = [theme()]
        expect(normalizeThemesConfig(input)).toEqual(input)
        expect(warn).not.toHaveBeenCalled()
    })

    test('null/undefined → [] silently (unset config is not an error)', () => {
        expect(normalizeThemesConfig(null)).toEqual([])
        expect(normalizeThemesConfig(undefined)).toEqual([])
        expect(warn).not.toHaveBeenCalled()
    })

    test('object instead of array (the Configure {} pre-seed) → [] with a warning', () => {
        expect(normalizeThemesConfig({})).toEqual([])
        expect(warn).toHaveBeenCalledOnce()
        expect(warn.mock.calls[0][0]).toMatch(/must be an array/)
    })

    test('theme missing filters gets filters: []', () => {
        const [t] = normalizeThemesConfig([theme({ filters: undefined })])
        expect(t.filters).toEqual([])
        expect(warn).not.toHaveBeenCalled()
    })

    test('filters as an object → [] with a warning, theme survives', () => {
        const result = normalizeThemesConfig([theme({ filters: {} })])
        expect(result).toHaveLength(1)
        expect(result[0].filters).toEqual([])
        expect(warn.mock.calls[0][0]).toMatch(/filters .* must be an array/)
    })

    test('non-object and id-less themes are dropped with warnings', () => {
        const result = normalizeThemesConfig(['nope', { label: 'no id' }, theme()])
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('need')
        expect(warn).toHaveBeenCalledTimes(2)
    })

    test('filters without id or property are dropped, valid siblings kept', () => {
        const result = normalizeThemesConfig([
            theme({
                filters: [
                    { label: 'no id', property: 'x', type: 'select' },
                    { id: 'noprop', label: 'y', type: 'select' },
                    { id: 'ok', label: 'ok', property: 'p', type: 'select' },
                ],
            }),
        ])
        expect(result[0].filters.map((f) => f.id)).toEqual(['ok'])
        expect(warn).toHaveBeenCalledTimes(2)
    })
})

describe('resolveDefaultThemeId', () => {
    const themes = [theme(), theme({ id: 'hazard' })]

    test('returns the configured id when it matches', () => {
        expect(resolveDefaultThemeId(themes, 'hazard')).toBe('hazard')
        expect(warn).not.toHaveBeenCalled()
    })

    test('falls back to the first theme with a warning when it matches nothing', () => {
        expect(resolveDefaultThemeId(themes, 'typo')).toBe('need')
        expect(warn.mock.calls[0][0]).toMatch(/matches no theme/)
    })

    test('unset default → first theme, silently; no themes → null', () => {
        expect(resolveDefaultThemeId(themes, undefined)).toBe('need')
        expect(resolveDefaultThemeId([], 'anything')).toBeNull()
        expect(warn).not.toHaveBeenCalled()
    })
})
