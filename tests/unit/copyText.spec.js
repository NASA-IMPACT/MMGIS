import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it, and
// with them a bundled THREE build, react-pdf and WebVR. Nothing in this
// test touches a viewer, so stub the aggregator to keep the mmgisAPI
// import chain light in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

// Issue #143 review follow-up - mmgisAPI.copyText(text) resolves true/false and
// never rejects: navigator.clipboard.writeText first, falling back to the
// hidden-textarea + execCommand path when the modern API is absent (insecure
// origin) OR rejects (iframe without clipboard-write, expired user gesture).

function setClipboard(value) {
    Object.defineProperty(window.navigator, 'clipboard', {
        value,
        configurable: true,
    })
}

test.describe('mmgisAPI.copyText', () => {
    beforeEach(() => {
        document.execCommand = vi.fn(() => true)
    })
    afterEach(() => {
        setClipboard(undefined)
        delete document.execCommand
    })

    test('uses the async Clipboard API when available', async () => {
        const writeText = vi.fn(() => Promise.resolve())
        setClipboard({ writeText })

        await expect(mmgisAPI.copyText('hello')).resolves.toBe(true)
        expect(writeText).toHaveBeenCalledWith('hello')
        expect(document.execCommand).not.toHaveBeenCalled()
    })

    test('falls back to execCommand when the modern API rejects', async () => {
        // e.g. an embedding iframe without allow="clipboard-write".
        setClipboard({ writeText: vi.fn(() => Promise.reject(new Error('denied'))) })

        await expect(mmgisAPI.copyText('hello')).resolves.toBe(true)
        expect(document.execCommand).toHaveBeenCalledWith('copy')
        // The transient textarea must not leak into the document.
        expect(document.querySelectorAll('textarea').length).toBe(0)
    })

    test('falls back to execCommand when the modern API is absent', async () => {
        setClipboard(undefined)

        await expect(mmgisAPI.copyText('hello')).resolves.toBe(true)
        expect(document.execCommand).toHaveBeenCalledWith('copy')
    })

    test('resolves false (never rejects) when every path fails', async () => {
        setClipboard(undefined)
        document.execCommand = vi.fn(() => {
            throw new Error('unsupported')
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(mmgisAPI.copyText('hello')).resolves.toBe(false)
        expect(document.querySelectorAll('textarea').length).toBe(0)
        warn.mockRestore()
    })

    test('resolves false when execCommand reports failure', async () => {
        setClipboard(undefined)
        document.execCommand = vi.fn(() => false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(mmgisAPI.copyText('hello')).resolves.toBe(false)
        warn.mockRestore()
    })
})
