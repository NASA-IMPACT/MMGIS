import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAvailableColormaps } from '../lib/hooks/useAvailableColormaps'
import { setColormapFallback } from '../lib/utils/colormapCache'
import { canReverseColormap } from '../lib/utils/colormaps'
import { mountHook } from '../../_shared/__tests__/reactHarness'

/**
 * The hook decides whether ramps are available from the service URL it is
 * handed and nothing else — see libBoundary.spec.js for why that matters.
 */

const BASE = 'https://titiler.test'
const NAMES = { colorMaps: ['viridis', 'viridis_r', 'accent'] }

const okResponse = (body: unknown) => ({ ok: true, json: async () => body })

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    delete (window as { mmgisglobal?: unknown }).mmgisglobal
})

describe('useAvailableColormaps', () => {
    test('lists the ramps the supplied service reports', async () => {
        global.fetch = vi.fn(async () => okResponse(NAMES)) as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(BASE))

        expect(global.fetch).toHaveBeenCalledWith(`${BASE}/colorMaps`)
        expect(result.current.colormaps).toEqual(['accent', 'viridis', 'viridis_r'])
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
        await unmount()
    })

    test('settles unavailable without a request when no service is supplied', async () => {
        global.fetch = vi.fn() as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(null))

        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.colormaps).toBeNull()
        // Never claims to be loading, so callers show "unavailable" rather
        // than a spinner that would hang forever.
        expect(result.current.loading).toBe(false)
        await unmount()
    })

    // Were the global consulted, this would fetch against an unresolved base.
    test('ignores a host global advertising a service', async () => {
        global.fetch = vi.fn() as never
        ;(window as { mmgisglobal?: unknown }).mmgisglobal = {
            WITH_TITILER: 'true',
            SERVER: 'node',
        }
        const { result, unmount } = await mountHook(() => useAvailableColormaps(null))

        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.colormaps).toBeNull()
        expect(result.current.loading).toBe(false)
        await unmount()
    })

    test('reports unavailable rather than throwing when the service errors', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(BASE))

        expect(result.current.colormaps).toBeNull()
        expect(result.current.error).toBeInstanceOf(Error)
        expect(result.current.loading).toBe(false)
        await unmount()
    })

    test('reports unavailable when the response carries no recognizable list', async () => {
        global.fetch = vi.fn(async () => okResponse({ nothing: true })) as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(BASE))

        expect(result.current.colormaps).toBeNull()
        expect(result.current.error).toBeNull()
        await unmount()
    })

    test('normalizes a trailing slash before requesting', async () => {
        global.fetch = vi.fn(async () => okResponse(NAMES)) as never
        const { unmount } = await mountHook(() => useAvailableColormaps(`${BASE}/`))

        expect(global.fetch).toHaveBeenCalledWith(`${BASE}/colorMaps`)
        await unmount()
    })
})

/**
 * With no service, or one whose list cannot be read, the host's own ramps are
 * listed instead, so a layer the host paints from bundled ramps can still
 * change them.
 */
describe('useAvailableColormaps with a host fallback', () => {
    const BUNDLED = ['jet', 'viridis', 'jet_r', 'viridis_r']
    beforeEach(() => {
        setColormapFallback({ list: async () => BUNDLED, colors: async () => null })
    })
    afterEach(() => setColormapFallback(null))

    test('lists the bundled ramps when no service is supplied', async () => {
        global.fetch = vi.fn() as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(null))

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.colormaps).toEqual(['jet', 'jet_r', 'viridis', 'viridis_r'])
        // A bundled ramp's reversed form is listed, so it can be reversed.
        expect(canReverseColormap('jet', result.current.colormaps)).toBe(true)
        await unmount()
    })

    test('lists the bundled ramps when the service list fails', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 502 })) as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(BASE))

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.colormaps).toEqual(['jet', 'jet_r', 'viridis', 'viridis_r'])
        await unmount()
    })

    test('keeps the service list when the service answers', async () => {
        global.fetch = vi.fn(async () => okResponse(NAMES)) as never
        const { result, unmount } = await mountHook(() => useAvailableColormaps(BASE))

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.colormaps).toEqual(['accent', 'viridis', 'viridis_r'])
        await unmount()
    })
})
