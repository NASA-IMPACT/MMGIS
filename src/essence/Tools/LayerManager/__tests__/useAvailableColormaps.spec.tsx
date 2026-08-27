import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAvailableColormaps } from '../lib/hooks/useAvailableColormaps'
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
 * Which ramps may be offered follows which renderer paints the layer. The
 * client-side renderer can only paint the ramps bundled with the app, so
 * offering a service's extra ramps there would advertise a choice that
 * silently renders as the fallback ramp instead.
 */
describe('useAvailableColormaps for a locally-rendered layer', () => {
    const LOCAL = ['inferno', 'viridis']

    test('offers only the local ramps, without asking a service', async () => {
        global.fetch = vi.fn() as never
        const { result, unmount } = await mountHook(() =>
            useAvailableColormaps(BASE, LOCAL, true),
        )

        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.colormaps).toEqual(['inferno', 'viridis'])
        expect(result.current.loading).toBe(false)
        await unmount()
    })

    // A tile-server-rendered layer can paint whatever that server registers,
    // so its extras belong in the list alongside the bundled ramps.
    test('unions local ramps with the service list for a server-rendered layer', async () => {
        global.fetch = vi.fn(async () => okResponse(NAMES)) as never
        const { result, unmount } = await mountHook(() =>
            useAvailableColormaps(BASE, LOCAL, false),
        )

        expect(result.current.colormaps).toEqual([
            'accent',
            'inferno',
            'viridis',
            'viridis_r',
        ])
        await unmount()
    })

    test('still offers the local ramps when a server-rendered layer has no service', async () => {
        global.fetch = vi.fn() as never
        const { result, unmount } = await mountHook(() =>
            useAvailableColormaps(null, LOCAL, false),
        )

        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.colormaps).toEqual(['inferno', 'viridis'])
        await unmount()
    })

    // The bundled ramps are the floor: an unreachable service degrades the
    // list rather than emptying it.
    test('keeps the local ramps when the service errors', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as never
        const { result, unmount } = await mountHook(() =>
            useAvailableColormaps(BASE, LOCAL, false),
        )

        expect(result.current.colormaps).toEqual(['inferno', 'viridis'])
        await unmount()
    })
})
