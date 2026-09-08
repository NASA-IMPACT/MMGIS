import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../colormapCache', () => ({ fetchColormapColors: vi.fn() }))
import { fetchColormapColors } from '../colormapCache'
import { resolveColormapColors } from '../resolveColormapColors'

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
        // 256 samples, matching TiTiler's own granularity.
        expect(colors).toHaveLength(256)
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
    it('falls back to the viridis ramp when the name is unknown and TiTiler resolves nothing', async () => {
        // Matches colormapLUT's fallback so the export never disagrees with
        // what deckRaster painted for the same unrecognized name.
        vi.mocked(fetchColormapColors).mockResolvedValue(null)
        const colors = await resolveColormapColors('customramp', null)
        expect(colors).toHaveLength(256)
        expect(colors[0]).toMatch(/^rgb\(/)
    })
    it('falls back to the viridis ramp — never throws — when fetchColormapColors rejects', async () => {
        vi.mocked(fetchColormapColors).mockRejectedValue(
            new Error('network down'),
        )
        const colors = await resolveColormapColors('customramp', 'http://t')
        expect(colors).toHaveLength(256)
        expect(colors[0]).toMatch(/^rgb\(/)
    })
})
