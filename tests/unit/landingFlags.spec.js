import { test, expect, vi } from 'vitest'

// landingFlags reads the query string through QueryURL, which pulls in the
// app's calls/capabilities modules on import; neither is exercised here.
vi.mock('../../src/pre/calls', () => ({ default: { api: vi.fn() } }))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import {
    hasForceLanding,
    hasPreview,
    buildMissionUrl,
} from '../../src/essence/Ancillary/landingFlags'

const at = (query) => window.history.replaceState({}, '', '/?' + query)

test.describe('the flags that ask for the landing page', () => {
    // Either casing, valued or bare, first pair or last: all of them are the
    // same request.
    test.each([
        'forcelanding',
        'forceLanding',
        'forcelanding=1',
        'forceLanding=1',
        'a=1&forcelanding&b=2',
        'a=1&forceLanding=1&b=2',
    ])('?%s is a force-landing request', (query) => {
        at(query)
        expect(hasForceLanding()).toBe(true)
    })

    test('a query naming neither spelling is not', () => {
        at('a=1&forcelandingx=1&b=2')
        expect(hasForceLanding()).toBe(false)
    })

    test.each(['_preview', '_preview=1', 'a=1&_preview&b=2'])(
        '?%s is a preview',
        (query) => {
            at(query)
            expect(hasPreview()).toBe(true)
        }
    )

    test('a query without _preview is not a preview', () => {
        at('a=1&b=2')
        expect(hasPreview()).toBe(false)
    })
})

test.describe('the mission URL', () => {
    const build = (search, extra) =>
        buildMissionUrl({
            search,
            pathnameHref: 'https://h/',
            ...extra,
        })

    test('a kept pair survives byte for byte', () => {
        // The percent-encoding is what QueryURL's readers decode. Re-encoding
        // through URLSearchParams would turn the %20 into a '+', which
        // decodeURIComponent leaves alone, and the layer would stop matching.
        expect(
            build('?on=Base%20Map%241.00&mapZoom=4', {
                mission: 'M',
                keepParams: true,
            })
        ).toBe('https://h/?on=Base%20Map%241.00&mapZoom=4&mission=M')
    })

    test('a mission name with a space is percent-encoded', () => {
        expect(
            build('', { mission: 'Two Words', keepParams: true })
        ).toBe('https://h/?mission=Two%20Words')
    })

    test('the flags that asked for the landing page are dropped', () => {
        expect(
            build('?forcelanding=1&keep=me&forceLanding&_preview', {
                mission: 'M',
                keepParams: true,
            })
        ).toBe('https://h/?keep=me&mission=M')
    })

    test('a mission already in the query is replaced, not repeated', () => {
        expect(
            build('?mission=Old&keep=me', { mission: 'New', keepParams: true })
        ).toBe('https://h/?keep=me&mission=New')
    })

    test('a swap keeps nothing but the mission', () => {
        expect(
            build('?on=Base%20Map&mapLat=1&site=3', {
                mission: 'Next',
                keepParams: false,
            })
        ).toBe('https://h/?mission=Next')
    })

    test('no mission leaves the URL naming none', () => {
        expect(build('?mission=Old&forcelanding=1', { keepParams: true })).toBe(
            'https://h/'
        )
    })
})
