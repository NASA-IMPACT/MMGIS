import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../colormapCache', () => ({ fetchColormapColors: vi.fn() }))
import { fetchColormapColors } from '../colormapCache'
import {
    resolveColormapColors,
    hasLocalColormap,
} from '../resolveColormapColors'

// A block body, not an implicit return: `mockReset()` returns the mock
// itself, and vitest treats a function returned from `beforeEach` as an
// implicit teardown — it would get invoked after each test, calling
// whatever rejection a test configured with no one awaiting it.
beforeEach(() => {
    vi.mocked(fetchColormapColors).mockReset()
})

describe('resolveColormapColors', () => {
    it('resolves a known name locally without touching TiTiler', async () => {
        vi.mocked(fetchColormapColors).mockRejectedValue(
            new Error('titiler is down'),
        )
        const colors = await resolveColormapColors('viridis', null)
        expect(colors).toHaveLength(32)
        expect(colors[0]).toMatch(/^rgb\(/)
        expect(fetchColormapColors).not.toHaveBeenCalled()
    })
    it('a _r name is the exact reverse of its forward ramp', async () => {
        const fwd = await resolveColormapColors('viridis')
        const rev = await resolveColormapColors('viridis_r')
        expect(rev).toEqual([...fwd].reverse())
    })
    it('falls back to TiTiler for unknown names', async () => {
        vi.mocked(fetchColormapColors).mockResolvedValue(['#000', '#fff'])
        const colors = await resolveColormapColors('customramp', 'http://t')
        expect(fetchColormapColors).toHaveBeenCalledWith(
            'customramp',
            'http://t',
        )
        expect(colors).toEqual(['#000', '#fff'])
    })
    it('reverses a TiTiler-resolved _r name locally', async () => {
        vi.mocked(fetchColormapColors).mockResolvedValue(['#000', '#fff'])
        expect(await resolveColormapColors('customramp_r', 'http://t')).toEqual(
            ['#fff', '#000'],
        )
    })
    it('resolves null when the name is unknown and TiTiler fails', async () => {
        vi.mocked(fetchColormapColors).mockResolvedValue(null)
        expect(await resolveColormapColors('customramp', null)).toBeNull()
    })
    it('hasLocalColormap is case-insensitive and _r-aware', () => {
        expect(hasLocalColormap('Viridis_r')).toBe(true)
        expect(hasLocalColormap('not_a_ramp')).toBe(false)
    })
})
