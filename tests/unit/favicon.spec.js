import { describe, test, expect } from 'vitest'
import { faviconHref } from '../../src/essence/Ancillary/Favicon'

describe('faviconHref', () => {
    test('prefers the favicon over the logo', () => {
        const look = { faviconurl: 'https://x/f.ico', logourl: 'https://x/l.png' }
        expect(faviconHref(look, 'Missions/Demo/')).toBe('https://x/f.ico')
    })

    test('falls back to the logo, resolved against the mission path', () => {
        const look = { faviconurl: '', logourl: 'Branding/uploads/a.png' }
        expect(faviconHref(look, 'Missions/Demo/')).toBe(
            'Missions/Demo/Branding/uploads/a.png'
        )
    })

    test('is empty when neither is set', () => {
        expect(faviconHref({}, 'Missions/Demo/')).toBe('')
    })

    test('falls back to the logo when the favicon is not a string', () => {
        const look = { faviconurl: 42, logourl: 'https://x/l.png' }
        expect(faviconHref(look, 'Missions/Demo/')).toBe('https://x/l.png')
    })

    test('leaves a lean upload key unprefixed', () => {
        const look = { faviconurl: 'assets/Demo/Branding/uploads/f.ico' }
        expect(faviconHref(look, 'Missions/Demo/')).toBe(
            'assets/Demo/Branding/uploads/f.ico'
        )
    })
})
