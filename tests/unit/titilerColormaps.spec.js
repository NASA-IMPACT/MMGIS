import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    fetchColormapColors,
    fetchColormapTable,
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

    // A deployment's own ramp, read into the shared table format.
    test('reads a ramp into 256 colours, transparency kept', async () => {
        const response = JSON.parse(
            readFileSync('tests/unit/fixtures/colormaps/veda/epa-ghgi-ch4.json', 'utf8')
        )
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })))

        const table = await fetchColormapTable('epa-ghgi-ch4', BASE)
        expect(Array.from(table.subarray(0, 4))).toEqual(response['0'])
        const colors = await fetchColormapColors('epa-ghgi-ch4', BASE)
        expect(colors).toHaveLength(256)
        expect(colors[0]).toBe('rgba(111, 76, 155, 0)')
    })

    // A response that is not a 256-colour table is not painted: the lookup
    // fails like any other, with a warning that names the ramp.
    test('a malformed ramp resolves to null with a warning naming it', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, json: async () => ({ 0: [0, 0, 0, 255] }) }))
        )

        expect(await fetchColormapColors('custom_ramp', BASE)).toBeNull()
        const [, error] = console.warn.mock.calls[0]
        expect(error.message).toBe(
            'Colormap "custom_ramp": expected 256 colours, got 1'
        )
    })
})
