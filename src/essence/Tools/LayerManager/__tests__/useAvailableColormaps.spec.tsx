import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAvailableColormaps } from '../lib/hooks/useAvailableColormaps'
import { useColormapColors } from '../lib/hooks/useColormapColors'
import { setColormapSource } from '../lib/utils/colormapSource'
import { mountHook } from '../../_shared/__tests__/reactHarness'

/**
 * The hooks ask only the installed source, never a service or a host global —
 * see libBoundary.spec.js for why that matters.
 */

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    setColormapSource(null)
    vi.restoreAllMocks()
})

describe('useAvailableColormaps', () => {
    test('lists the source’s ramps for the layer, each reversed form after its forward one', async () => {
        const list = vi.fn(async () => ['viridis_r', 'accent', 'viridis'])
        setColormapSource({ list, colors: async () => null })
        const { result, unmount } = await mountHook(() => useAvailableColormaps('layerA'))

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(list).toHaveBeenCalledWith('layerA')
        expect(result.current.colormaps).toEqual(['accent', 'viridis', 'viridis_r'])
        await unmount()
    })

    test('settles unavailable with no source installed', async () => {
        const { result, unmount } = await mountHook(() => useAvailableColormaps('layerA'))

        expect(result.current.colormaps).toBeNull()
        // Never claims to be loading, so callers show "unavailable" rather
        // than a spinner that would hang forever.
        expect(result.current.loading).toBe(false)
        await unmount()
    })

    test('reports unavailable rather than throwing when the source fails', async () => {
        setColormapSource({
            list: async () => {
                throw new Error('boom')
            },
            colors: async () => null,
        })
        const { result, unmount } = await mountHook(() => useAvailableColormaps('layerA'))

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.colormaps).toBeNull()
        await unmount()
    })
})

describe('useColormapColors', () => {
    test('asks for the forward ramp and reverses it locally', async () => {
        const colors = vi.fn(async () => ['#000', '#fff'])
        setColormapSource({ list: async () => null, colors })
        const { result, unmount } = await mountHook(() =>
            useColormapColors('Viridis_r', true, 'layerA'),
        )

        await vi.waitFor(() => expect(result.current.loading).toBe(false))
        expect(colors).toHaveBeenCalledWith('layerA', 'viridis')
        expect(result.current.colors).toEqual(['#fff', '#000'])
        await unmount()
    })

    test('asks nothing until enabled', async () => {
        const colors = vi.fn(async () => ['#000'])
        setColormapSource({ list: async () => null, colors })
        const { result, unmount } = await mountHook(() =>
            useColormapColors('viridis', false, 'layerA', false),
        )

        expect(colors).not.toHaveBeenCalled()
        expect(result.current.colors).toBeNull()
        await unmount()
    })
})
