import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    fetchColormapColors,
    clearColormapCache,
} from '../../src/essence/Basics/Colormaps/titilerColormaps'

const BASE = 'https://titiler.test'

const timeoutError = () =>
    new DOMException('The operation timed out.', 'TimeoutError')

beforeEach(() => {
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('fetchColormapColors', () => {
    // A service that accepts the connection and never answers would leave the
    // lookup pending forever, and every bulk legend request with it. The fetch
    // carries a deadline, so it rejects instead.
    test('gives the request a deadline', async () => {
        const fetch = vi.fn(async () => {
            throw timeoutError()
        })
        vi.stubGlobal('fetch', fetch)
        const timeout = vi.spyOn(AbortSignal, 'timeout')

        await fetchColormapColors('custom_ramp', BASE)

        expect(timeout).toHaveBeenCalledWith(5000)
        expect(fetch).toHaveBeenCalledWith(`${BASE}/colorMaps/custom_ramp`, {
            signal: expect.any(AbortSignal),
        })
    })

    // A lookup that timed out is a failed one: null to the caller, and
    // remembered for the failure TTL so the service is not re-dialled — and
    // every legend re-blocked on it — straight away.
    test('a timed-out lookup resolves to null and is remembered', async () => {
        const fetch = vi.fn(async () => {
            throw timeoutError()
        })
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapColors('custom_ramp', BASE)).toBeNull()
        expect(await fetchColormapColors('custom_ramp', BASE)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    // The same for an abort raised by the signal itself.
    test('an aborted lookup resolves to null and is remembered', async () => {
        const fetch = vi.fn(async () => {
            throw new DOMException('The operation was aborted.', 'AbortError')
        })
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapColors('custom_ramp', BASE)).toBeNull()
        expect(await fetchColormapColors('custom_ramp', BASE)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})
