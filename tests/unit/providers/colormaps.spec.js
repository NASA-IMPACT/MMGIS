import { test, expect } from 'vitest'
import { registerColormapProviders } from '../../../src/essence/mmgisAPI/providers/colormaps'
import { resolveColormapColors } from '../../../src/essence/Basics/Colormaps/resolveColormapColors'

/**
 * Core's bundled ramps on the bus, for a ramp picker with no tiling service:
 * the names forward and reversed, and each ramp's colours as the map paints
 * them.
 */
const providers = {}
registerColormapProviders({ provide: (name, fn) => (providers[name] = fn) })

test('lists each bundled ramp forward and reversed', () => {
    const names = providers['colormaps:getBundledNames']()
    expect(names).toEqual(expect.arrayContaining(['viridis', 'viridis_r', 'jet', 'jet_r']))
    expect(names.length % 2).toBe(0)
})

test('answers a bundled ramp with the colours the map paints', async () => {
    expect(await providers['colormaps:getBundledColors']('jet')).toEqual(
        await resolveColormapColors('jet', null)
    )
})

test('answers null for a ramp it does not bundle', async () => {
    expect(await providers['colormaps:getBundledColors']('site_ramp')).toBeNull()
    expect(await providers['colormaps:getBundledColors'](42)).toBeNull()
})
