import { test, expect, vi } from 'vitest'

// landingFlags reads the query string through QueryURL, which pulls in the
// app's calls module on import; that one is never exercised here. The build
// personality is mocked because it is the switch nameMissionInUrl reads
// first.
vi.mock('../../src/pre/calls', () => ({ default: { api: vi.fn() } }))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import {
    hasForceLanding,
    hasPreview,
    buildMissionUrl,
    nameMissionInUrl,
} from '../../src/essence/Ancillary/landingFlags'
import { isStaticBuild } from '../../src/pre/capabilities'

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

test.describe('deciding whether to name the mission', () => {
    const enter = (search) => window.history.replaceState({}, '', '/' + search)

    test.beforeEach(() => {
        isStaticBuild.mockReturnValue(false)
    })

    test('a static build writes nothing', () => {
        // The one entry URL a served build would certainly rewrite, so the
        // guard is what the assertion is about.
        enter('')
        isStaticBuild.mockReturnValue(true)

        expect(nameMissionInUrl({ mission: 'Baked', swapping: false })).toBe(
            false
        )
        expect(window.location.search).toBe('')
    })

    test('a static build with no mission name still writes nothing', () => {
        // The name is checked only once a URL is going to be written, so a
        // static build is never held to one it has no use for.
        enter('')
        isStaticBuild.mockReturnValue(true)

        expect(nameMissionInUrl({ mission: undefined, swapping: false })).toBe(
            false
        )
        expect(window.location.search).toBe('')
    })

    test('a mission name that names nothing is refused when a URL is due', () => {
        enter('')

        expect(() =>
            nameMissionInUrl({ mission: undefined, swapping: false })
        ).toThrow('Invalid mission name')
    })

    test('a bare entry URL is given the mission', () => {
        enter('')

        expect(nameMissionInUrl({ mission: 'M', swapping: false })).toBe(true)
        expect(window.location.search).toBe('?mission=M')
    })

    test('a landing flag names the mission and keeps the rest of the query', () => {
        enter('?keep=me&forcelanding')

        expect(nameMissionInUrl({ mission: 'M', swapping: false })).toBe(true)
        expect(window.location.search).toBe('?keep=me&mission=M')
    })

    test('a preview flag asks the same', () => {
        enter('?keep=me&_preview')

        expect(nameMissionInUrl({ mission: 'M', swapping: false })).toBe(true)
        expect(window.location.search).toBe('?keep=me&mission=M')
    })

    test('a swap names the new mission and drops the old pairs', () => {
        enter('?on=Base%20Map&mapLat=1')

        expect(nameMissionInUrl({ mission: 'Next', swapping: true })).toBe(true)
        expect(window.location.search).toBe('?mission=Next')
    })

    test('a deeplink carrying no flag is left as the visitor sent it', () => {
        enter('?on=Base%20Map&mapLat=1')

        expect(nameMissionInUrl({ mission: 'M', swapping: false })).toBe(false)
        expect(window.location.search).toBe('?on=Base%20Map&mapLat=1')
    })
})
