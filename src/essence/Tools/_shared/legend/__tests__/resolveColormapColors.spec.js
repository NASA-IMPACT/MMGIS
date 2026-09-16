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
    it('resolves a known name locally, and a _r name as its exact reverse', async () => {
        vi.mocked(fetchColormapColors).mockRejectedValue(
            new Error('titiler is down'),
        )
        const forward = await resolveColormapColors('viridis', null)
        // 256 samples, matching TiTiler's own granularity.
        expect(forward).toHaveLength(256)
        expect(await resolveColormapColors('viridis_r')).toEqual(
            [...forward].reverse(),
        )
        expect(fetchColormapColors).not.toHaveBeenCalled()
    })

    // An unknown name is TiTiler's to answer; a service that cannot answer
    // falls back to viridis — matching colormapLUT, so the export never
    // disagrees with what deckRaster painted — rather than throwing.
    it('asks TiTiler for a name it does not hold, and never throws', async () => {
        vi.mocked(fetchColormapColors).mockResolvedValue(['#000', '#fff'])
        expect(await resolveColormapColors('customramp', 'http://t')).toEqual([
            '#000',
            '#fff',
        ])
        expect(fetchColormapColors).toHaveBeenCalledWith(
            'customramp',
            'http://t',
        )
        vi.mocked(fetchColormapColors).mockRejectedValue(
            new Error('network down'),
        )
        expect(
            await resolveColormapColors('customramp', 'http://t'),
        ).toHaveLength(256)
    })
})
