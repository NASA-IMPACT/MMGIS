import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// provider under test never touches Map_, so a bare stub keeps the graph
// loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getLegend` is core's answer to "what is this layer's legend".
 *
 * The answer is layer truth, not presentation, which is why it lives here: a
 * raster's legend is the colormap it paints through and the bounds it is
 * scaled to, and both change while the dashboard runs. Anything drawing a
 * legend — the Layers panel, an export — asks this rather than reading the
 * layer store and deciding for itself.
 */

const RASTER = 'Elevation_0123456789abcdef'
const VELOCITY = 'Currents_fedcba9876543210'

const cogLayer = (fields = {}) => ({
    type: 'tile',
    url: 'COG:/path/to/raster.tif',
    cogTransform: true,
    cogColormap: 'viridis',
    ...fields,
})

// What LayersTool.populateCogScale writes back into `_legend`: a snapshot of
// the ramp, sampled into nine stops.
const derivedLegend = (unit) =>
    [0, 5, 10].map((value) => ({
        shape: 'continuous',
        color: '#123456',
        value: `${value}${unit}`,
    }))

let providers

const withLayers = (data) => {
    L_.layers.data = data
    L_.layers.nameToUUID = Object.fromEntries(
        Object.entries(data).map(([uuid, cfg]) => [cfg.display_name ?? uuid, [uuid]])
    )
    providers = {}
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
    }
    L_.fina(null, null, null, null, null, null)
}

beforeEach(() => {
    // No tiling service: every ramp under test is one the bundled colormaps
    // hold, so nothing needs fetching.
    window.mmgisglobal = { SERVER: 'node' }
})

afterAll(() => {
    delete window.mmgisAPI
    delete window.mmgisglobal
    L_.layers.data = {}
    L_.layers.nameToUUID = {}
})

describe('layers:getLegend', () => {
    // The whole reason this moved into core. LayersTool writes its own
    // derived legend into the same `_legend` field an authored one uses, and a
    // user changing the ramp leaves that snapshot stale. Live colormap state
    // is what the layer is actually painting, so it is what the legend says.
    test('answers a raster from its live colormap, not from `_legend`', async () => {
        withLayers({
            [RASTER]: cogLayer({
                _legend: derivedLegend(' m'),
                cogMin: 0,
                cogMax: 10,
                cogUnits: 'm',
                currentCogColormap: 'plasma',
                currentCogMin: 2,
                currentCogMax: 8,
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('gradient')
        expect(legend.colormap).toBe('plasma')
        expect(legend.min).toBe(2)
        expect(legend.max).toBe(8)
        expect(legend.unit).toEqual({ label: 'm' })
        // Resolved colors, not the stale snapshot's three stops.
        expect(legend.stops).toHaveLength(256)
        expect(legend.stops).not.toContain('#123456')
    })

    // A raster nobody rescaled has no range to report. 0 and 255 would print
    // as an authoritative range the layer was never scaled to, so the labels
    // go blank instead.
    test('reports null bounds for a raster with no configured rescale', async () => {
        withLayers({ [RASTER]: cogLayer() })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.min).toBeNull()
        expect(legend.max).toBeNull()
        expect(legend.stops).toHaveLength(256)
    })

    // populateCogScale runs for velocity layers too, and they paint no COG
    // colormap — so the legend it derived is the only one they have.
    test("keeps a velocity layer's derived legend", async () => {
        withLayers({
            [VELOCITY]: {
                type: 'velocity',
                _legend: derivedLegend(' m/s'),
            },
        })

        const legend = await providers['layers:getLegend'](VELOCITY)

        expect(legend.type).toBe('gradient')
        expect(legend.stops).toEqual(['#123456', '#123456', '#123456'])
        expect(legend.min).toBe(0)
        expect(legend.max).toBe(10)
        expect(legend.unit).toEqual({ label: 'm/s' })
    })

    // The mixed form documented in docs/pages/Tools/Legend/Legend.md: runs of
    // discreet/continuous entries interleaved with individually shaped ones,
    // all labelled with words. Reading the first entry's shape alone would
    // make the whole thing one gradient, with two of those words as its bounds.
    test('reads a mixed-shape legend as swatches, not one gradient', async () => {
        withLayers({
            Terrain: {
                type: 'vector',
                _legend: [
                    { color: 'purple', shape: 'discreet', value: 'This' },
                    { color: 'cyan', shape: 'continuous', value: 'is' },
                    { color: 'pink', shape: 'circle', value: 'csv' },
                ],
            },
        })

        const legend = await providers['layers:getLegend']('Terrain')

        expect(legend.type).toBe('categorical')
        expect(legend.swatches.map((s) => s.label)).toEqual(['This', 'is', 'csv'])
        expect(legend.stops).toBeNull()
    })

    // A hidden nodata class is not a swatch, and its value is not a bound:
    // -9999 would otherwise become the printed minimum of the ramp.
    test('drops entries the author hid, bounds included', async () => {
        withLayers({
            Slope: {
                type: 'vector',
                _legend: [
                    { shape: 'continuous', color: '#000000', value: '0 deg' },
                    { shape: 'continuous', color: '#ffffff', value: '90 deg' },
                    {
                        shape: 'continuous',
                        color: '#ff00ff',
                        value: '-9999 deg',
                        hideFromLegend: true,
                    },
                ],
            },
        })

        const legend = await providers['layers:getLegend']('Slope')

        expect(legend.stops).toEqual(['#000000', '#ffffff'])
        expect(legend.min).toBe(0)
        expect(legend.max).toBe(90)
    })

    // The call shape every other layer-keyed provider uses: one layer by
    // either identifier, or the whole mission keyed by UUID.
    test('answers by uuid, by display name, or for every layer at once', async () => {
        withLayers({
            [RASTER]: cogLayer({ display_name: 'Elevation' }),
            [VELOCITY]: { type: 'velocity', display_name: 'Currents' },
        })

        expect((await providers['layers:getLegend']('Elevation')).colormap).toBe('viridis')
        expect(await providers['layers:getLegend']('NoSuchLayer')).toBeNull()

        const all = await providers['layers:getLegend']()
        expect(Object.keys(all)).toEqual([RASTER, VELOCITY])
        expect(all[VELOCITY].type).toBe('none')
    })
})
