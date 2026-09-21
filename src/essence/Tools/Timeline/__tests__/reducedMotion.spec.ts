import { describe, test, expect, afterEach, vi } from 'vitest'
import { prefersReducedMotion } from '../lib/utils/reducedMotion'

/**
 * The reduced-motion preference as script reads it. jsdom ships no
 * `matchMedia` at all, which is the first case below and the reason every
 * read of it is guarded.
 */
describe('prefersReducedMotion', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const withMatchMedia = (matchMedia: unknown) =>
        vi.stubGlobal('matchMedia', matchMedia)

    test('reads as no preference where matchMedia is missing', () => {
        withMatchMedia(undefined)
        expect(typeof window.matchMedia).not.toBe('function')
        expect(prefersReducedMotion()).toBe(false)
    })

    test('reads the preference when it is set', () => {
        withMatchMedia((query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
        }))
        expect(prefersReducedMotion()).toBe(true)
    })

    test('reads as no preference when the query does not match', () => {
        withMatchMedia(() => ({ matches: false }))
        expect(prefersReducedMotion()).toBe(false)
    })

    test('reads as no preference when matchMedia throws', () => {
        withMatchMedia(() => {
            throw new Error('unsupported')
        })
        expect(prefersReducedMotion()).toBe(false)
    })
})
