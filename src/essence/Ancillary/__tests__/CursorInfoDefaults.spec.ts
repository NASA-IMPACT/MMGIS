import { describe, test, expect, beforeEach } from 'vitest'
import CursorInfo from '../CursorInfo'

const styleOf = () => (CursorInfo as any).cursorInfoDiv[0].style

beforeEach(() => {
    document.body.innerHTML = ''
    ;(CursorInfo as any).cursorInfoDiv = null
    CursorInfo.init()
    CursorInfo.setDefaults(null)
})

describe('CursorInfo mission colours', () => {
    test('falls back to the built-in colours when none are configured', () => {
        CursorInfo.update('hello', null, false)
        expect(styleOf().backgroundColor).toBe('var(--color-a)')
        expect(styleOf().color).toBe('rgb(220, 220, 220)')
    })

    test('uses the configured background and text colour', () => {
        CursorInfo.setDefaults({ background: '#7a1020', color: '#ffffff' })
        CursorInfo.update('hello', null, false)
        expect(styleOf().backgroundColor).toBe('rgb(122, 16, 32)')
        expect(styleOf().color).toBe('rgb(255, 255, 255)')
    })

    test('an error still reads as an error, whatever the mission sets', () => {
        CursorInfo.setDefaults({ background: '#7a1020', color: '#ffffff' })
        CursorInfo.update('bad', null, true)
        expect(styleOf().backgroundColor).toBe('rgb(205, 4, 55)')
    })

    test('a caller asking for a specific colour still wins', () => {
        CursorInfo.setDefaults({ background: '#7a1020', color: '#ffffff' })
        CursorInfo.update('hello', null, false, null, '#00ff00', '#000000')
        expect(styleOf().backgroundColor).toBe('rgb(0, 255, 0)')
        expect(styleOf().color).toBe('rgb(0, 0, 0)')
    })

    test('an empty configured colour counts as unset', () => {
        CursorInfo.setDefaults({ background: '', color: '' })
        CursorInfo.update('hello', null, false)
        expect(styleOf().backgroundColor).toBe('var(--color-a)')
        expect(styleOf().color).toBe('rgb(220, 220, 220)')
    })
})
