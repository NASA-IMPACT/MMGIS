import { test, expect, describe } from 'vitest'
import { interpretThemeSelection } from '../../src/essence/Tools/LayerFilter/lib/utils/themeSelection.ts'

// The panel narrows the layers list only after a real user interaction. The
// rail announces its boot-time default too (the panel no longer derives one
// from its own config), so `initial` is what keeps boot from narrowing.
describe('LayerFilter interpretThemeSelection', () => {
    test('a plain selection counts as user interaction', () => {
        expect(interpretThemeSelection({ themeId: 'hazard' })).toEqual({
            themeId: 'hazard',
            isInteraction: true,
        })
    })

    test('an initial selection selects the theme without counting as interaction', () => {
        expect(
            interpretThemeSelection({ themeId: 'need', initial: true }),
        ).toEqual({ themeId: 'need', isInteraction: false })
    })

    test('initial: false is an ordinary interaction', () => {
        expect(
            interpretThemeSelection({ themeId: 'need', initial: false }),
        ).toEqual({ themeId: 'need', isInteraction: true })
    })

    test('a non-boolean initial is not treated as initial', () => {
        expect(
            interpretThemeSelection({ themeId: 'need', initial: 'yes' }),
        ).toEqual({ themeId: 'need', isInteraction: true })
    })

    test.each([
        ['no payload', undefined],
        ['null payload', null],
        ['non-object payload', 'need'],
        ['missing themeId', { initial: true }],
        ['empty themeId', { themeId: '' }],
        ['non-string themeId', { themeId: 3 }],
    ])('%s is ignored', (_label, payload) => {
        expect(interpretThemeSelection(payload)).toBeNull()
    })
})
