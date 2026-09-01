import { test, expect, vi, beforeEach } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it, and
// with them a bundled THREE build, react-pdf and WebVR. Nothing here touches
// a viewer, so stub the aggregator to keep the QueryURL import chain light.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/pre/calls', () => ({ default: { api: vi.fn() } }))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import QueryURL from '../../src/essence/Ancillary/QueryURL'

// The two URL readers run while the app is booting, so their contract is
// narrow and load-bearing: `false` means "not in the URL" (every caller
// strict-checks `!== false`), `''` means "there with no value". A value
// containing a raw '=' must survive whole — our own share links are built
// with encodeURI, which leaves '=' alone — and a malformed percent-encoding
// must never throw out of them and kill the page load.

const setQuery = (query) => window.history.replaceState({}, '', '/?' + query)

beforeEach(() => {
    window.history.replaceState({}, '', '/')
})

test.describe('QueryURL.getSingleQueryVariable', () => {
    test('returns false when the param is absent', () => {
        setQuery('mission=Test')
        expect(QueryURL.getSingleQueryVariable('site')).toBe(false)
    })

    test("returns '' for a valueless param", () => {
        setQuery('site')
        expect(QueryURL.getSingleQueryVariable('site')).toBe('')
    })

    test('keeps a value containing a raw equals sign whole', () => {
        setQuery('token=abc=xyz')
        expect(QueryURL.getSingleQueryVariable('token')).toBe('abc=xyz')
    })

    test('returns false for a malformed percent-encoding, without throwing', () => {
        setQuery('site=%zz')
        expect(() =>
            expect(QueryURL.getSingleQueryVariable('site')).toBe(false)
        ).not.toThrow()
    })

    test('first occurrence wins for a repeated param', () => {
        setQuery('site=first&site=second')
        expect(QueryURL.getSingleQueryVariable('site')).toBe('first')
    })
})

test.describe('QueryURL.getMultipleQueryVariable', () => {
    test('returns false when the param is absent', () => {
        setQuery('mission=Test')
        expect(QueryURL.getMultipleQueryVariable('searchstr')).toBe(false)
    })

    test("pushes '' for a valueless param", () => {
        setQuery('searchstr&searchstr=b')
        expect(QueryURL.getMultipleQueryVariable('searchstr')).toEqual(['', 'b'])
    })

    test('keeps a value containing a raw equals sign whole', () => {
        setQuery('searchstr=abc=xyz')
        expect(QueryURL.getMultipleQueryVariable('searchstr')).toEqual([
            'abc=xyz',
        ])
    })

    test('skips a malformed percent-encoding, without throwing', () => {
        setQuery('searchstr=%zz&searchstr=ok')
        expect(() =>
            expect(QueryURL.getMultipleQueryVariable('searchstr')).toEqual([
                'ok',
            ])
        ).not.toThrow()
    })

    test('lowercases the param name it matches', () => {
        setQuery('SearchStr=a')
        expect(QueryURL.getMultipleQueryVariable('searchstr')).toEqual(['a'])
    })
})
