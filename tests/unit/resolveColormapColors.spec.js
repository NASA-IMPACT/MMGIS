import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock(
    '../../src/essence/Basics/Colormaps/titilerColormaps',
    () => ({ fetchColormapColors: vi.fn() })
)
import { fetchColormapColors } from '../../src/essence/Basics/Colormaps/titilerColormaps'
import { resolveColormapColors } from '../../src/essence/Basics/Colormaps/resolveColormapColors'

// A block body, not an implicit return: `mockReset()` returns the mock itself,
// and vitest treats a function returned from `beforeEach` as an implicit
// teardown — it would get invoked after each test, calling whatever rejection
// a test configured with no one awaiting it.
beforeEach(() => {
    vi.mocked(fetchColormapColors).mockReset()
})

/**
 * A legend has to paint the same ramp the map painted, and it must produce
 * something whatever happens — a bar that renders nothing is worse than a bar
 * that renders the fallback the renderer itself uses.
 */
describe('resolveColormapColors', () => {
    test('resolves a bundled ramp locally, `_r` as its exact mirror', async () => {
        const forward = await resolveColormapColors('viridis', 'http://titiler.test')

        // 256 samples, matching the tiling service's own granularity.
        expect(forward).toHaveLength(256)
        expect(await resolveColormapColors('viridis_r')).toEqual([...forward].reverse())
        // Nothing the bundle holds is worth a round trip.
        expect(fetchColormapColors).not.toHaveBeenCalled()
    })

    // A ramp only the deployment knows is the service's to define. A service
    // that cannot answer falls back to the same viridis the raster renderer
    // paints for an unknown colormap, rather than throwing or rendering blank.
    test('asks the service for a ramp it does not hold, and never throws', async () => {
        vi.mocked(fetchColormapColors).mockResolvedValue(['#000', '#fff'])
        expect(await resolveColormapColors('missionramp', 'http://titiler.test')).toEqual([
            '#000',
            '#fff',
        ])

        vi.mocked(fetchColormapColors).mockRejectedValue(new Error('network down'))
        expect(await resolveColormapColors('missionramp', 'http://titiler.test')).toHaveLength(
            256,
        )
    })
})
