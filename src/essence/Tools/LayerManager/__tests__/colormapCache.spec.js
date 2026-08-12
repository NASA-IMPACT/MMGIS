import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    fetchColormapColors,
    clearColormapCache,
    resolveTiTilerBase,
} from '../lib/utils/colormapCache.ts'

const BASE = 'https://titiler.test'
const VIRIDIS = { 0: [68, 1, 84, 255], 1: [253, 231, 37, 255] }

const okResponse = (body) => ({ ok: true, json: async () => body })

beforeEach(() => {
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

test.describe('resolveTiTilerBase', () => {
    test('strips a trailing slash from the supplied URL', () => {
        expect(resolveTiTilerBase('https://titiler.test/')).toBe(BASE)
    })

    test('is null when no service is supplied, with no host fallback', () => {
        expect(resolveTiTilerBase(null)).toBe(null)
        expect(resolveTiTilerBase(undefined)).toBe(null)
        expect(resolveTiTilerBase('')).toBe(null)
    })
})

test.describe('fetchColormapColors', () => {
    test('resolves a ramp to ordered CSS colors', async () => {
        global.fetch = vi.fn(async () => okResponse(VIRIDIS))
        expect(await fetchColormapColors('viridis', BASE)).toEqual([
            'rgba(68, 1, 84, 1)',
            'rgba(253, 231, 37, 1)',
        ])
        expect(global.fetch).toHaveBeenCalledWith(`${BASE}/colorMaps/viridis`)
    })

    test('concurrent requests for one ramp share a single fetch', async () => {
        global.fetch = vi.fn(async () => okResponse(VIRIDIS))
        const [a, b] = await Promise.all([
            fetchColormapColors('viridis', BASE),
            fetchColormapColors('viridis', BASE),
        ])
        expect(a).toEqual(b)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    test('a resolved ramp is served from cache on later calls', async () => {
        global.fetch = vi.fn(async () => okResponse(VIRIDIS))
        await fetchColormapColors('viridis', BASE)
        await fetchColormapColors('viridis', BASE)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    test('the same ramp name on two services is cached separately', async () => {
        global.fetch = vi.fn(async () => okResponse(VIRIDIS))
        await fetchColormapColors('viridis', BASE)
        await fetchColormapColors('viridis', 'https://other.test')
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('a failed response is not cached, so a later call retries', async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 500 })
            .mockResolvedValueOnce(okResponse(VIRIDIS))
        expect(await fetchColormapColors('viridis', BASE)).toBe(null)
        expect(await fetchColormapColors('viridis', BASE)).toEqual([
            'rgba(68, 1, 84, 1)',
            'rgba(253, 231, 37, 1)',
        ])
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('a fetch that throws synchronously does not poison the cache', async () => {
        global.fetch = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('no transport')
            })
            .mockImplementationOnce(async () => okResponse(VIRIDIS))
        expect(await fetchColormapColors('viridis', BASE)).toBe(null)
        expect(await fetchColormapColors('viridis', BASE)).not.toBe(null)
    })

    test('resolves to null without fetching when no service is reachable', async () => {
        global.fetch = vi.fn()
        expect(await fetchColormapColors('viridis', null)).toBe(null)
        expect(await fetchColormapColors('', BASE)).toBe(null)
        expect(global.fetch).not.toHaveBeenCalled()
    })
})
