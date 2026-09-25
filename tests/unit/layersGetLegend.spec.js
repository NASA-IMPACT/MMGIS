import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// provider under test never touches Map_, so a bare stub keeps the graph
// loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)
const { resolveColormapColors } = await import(
    '../../src/essence/Basics/Colormaps/resolveColormapColors'
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

    // A raster names its unit in `cogUnits`, but plenty of missions only ever
    // wrote it into the legend text. Live colormap state replaces the ramp,
    // and taking the unit with it would leave the bar labelled bare.
    test('falls back to the declared legend for a unit cogUnits omits', async () => {
        withLayers({
            [RASTER]: cogLayer({
                cogMin: 0,
                cogMax: 10,
                _legend: derivedLegend(' m'),
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('gradient')
        expect(legend.unit).toEqual({ label: 'm' })
    })

    // A classified raster paints through a colormap and still declares what
    // its classes mean. No ramp can stand in for those, so live colormap state
    // replaces the bar, never the classes — and the controls over the ramp
    // come along so the layer does not lose them by being classified.
    test("keeps a classified raster's classes rather than drawing a ramp", async () => {
        withLayers({
            [RASTER]: cogLayer({
                cogMin: 0,
                cogMax: 2,
                _legend: [
                    { color: '#a00000', value: 'Water' },
                    { color: '#00a000', value: 'Forest' },
                ],
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('categorical')
        expect(legend.swatches).toEqual([
            { color: '#a00000', label: 'Water' },
            { color: '#00a000', label: 'Forest' },
        ])
        expect(legend.stops).toBeNull()
        expect(legend.colormap).toBe('viridis')
        expect(legend.min).toBe(0)
        expect(legend.max).toBe(2)
    })

    // A classified raster may draw its classes as circles or rects; any shape
    // outside a scale marks the entries as classes, which stay swatches.
    test('keeps non-scale shaped classes on a raster as swatches', async () => {
        withLayers({
            [RASTER]: cogLayer({
                cogMin: 0,
                cogMax: 2,
                _legend: [
                    { shape: 'circle', color: '#a00000', label: 'Water' },
                    { shape: 'rect', color: '#00a000', label: 'Forest' },
                ],
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('categorical')
        expect(legend.swatches).toEqual([
            { color: '#a00000', label: 'Water' },
            { color: '#00a000', label: 'Forest' },
        ])
        expect(legend.stops).toBeNull()
    })

    // Scale-shaped entries labelled with words describe a ramp, not classes.
    // Drawing them as 'Low'/'High' swatches would stop the bar following the
    // live colormap and its rescale.
    test('draws the live ramp for a raster whose scale is labelled with words', async () => {
        withLayers({
            [RASTER]: cogLayer({
                cogMin: 3,
                cogMax: 7,
                _legend: [
                    { shape: 'continuous', color: '#123456', value: 'Low' },
                    { shape: 'continuous', color: '#654321', value: 'High' },
                ],
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('gradient')
        expect(legend.swatches).toBeNull()
        expect(legend.stops).toEqual(await resolveColormapColors('viridis', null))
        expect(legend.stops).not.toContain('#123456')
        expect(legend.min).toBe(3)
        expect(legend.max).toBe(7)
    })

    // The legend LayersTool derives before any rescale is set carries 'NaN'
    // and blank labels. It is still a ramp, and with no bounds configured the
    // bar goes unlabelled rather than turning into swatches.
    test('draws the live ramp for a derived legend with NaN labels and no bounds', async () => {
        withLayers({
            [RASTER]: cogLayer({
                currentCogColormap: 'plasma',
                _legend: [
                    { shape: 'continuous', color: '#123456', value: 'NaN' },
                    { shape: 'continuous', color: '#345678', value: '' },
                    { shape: 'continuous', color: '#654321', value: 'NaN' },
                ],
            }),
        })

        const legend = await providers['layers:getLegend'](RASTER)

        expect(legend.type).toBe('gradient')
        expect(legend.swatches).toBeNull()
        expect(legend.stops).toEqual(await resolveColormapColors('plasma', null))
        expect(legend.min).toBeNull()
        expect(legend.max).toBeNull()
    })

    // Hiding every entry leaves nothing to draw, which is not the same as a
    // legend of no entries being some other shape.
    test('answers nothing to draw when every entry is hidden', async () => {
        withLayers({
            Slope: {
                type: 'vector',
                _legend: [
                    { color: '#ff0000', value: 'nodata', hideFromLegend: true },
                ],
            },
        })

        expect((await providers['layers:getLegend']('Slope')).type).toBe('none')
    })

    // Missions carry hand-written legends and hand-written service URLs, and
    // one of them being malformed must cost that layer its legend and no
    // more. The map answer would otherwise reject outright, leaving a panel
    // with nothing at all to draw.
    test('a layer nothing can be built from costs only itself', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        withLayers({
            // `.replace` on a number: a bad service URL throws before the
            // legend is even reached.
            Broken: { type: 'vector', titilerUrl: 123 },
            // A hole in the entry list, which is read past rather than thrown on.
            Holey: {
                type: 'vector',
                _legend: [null, { color: '#a00000', value: 'Water' }],
            },
            [VELOCITY]: { type: 'velocity', _legend: derivedLegend(' m/s') },
        })

        const all = await providers['layers:getLegend']()

        expect(all.Broken.type).toBe('none')
        expect(all.Holey.swatches).toEqual([{ color: '#a00000', label: 'Water' }])
        expect(all[VELOCITY].type).toBe('gradient')
        // Proves the failure was caught and named rather than never happening.
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Broken'),
            expect.any(Error)
        )
        warn.mockRestore()
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

    // A scale can be authored either way round, and LayersTool writes its
    // derived one high to low. Everything downstream paints the stops left to
    // right against the minimum printed on the left, so a descending run has
    // to be turned round or the ramp runs opposite to its own labels.
    test('turns a descending declared gradient the right way round', async () => {
        withLayers({
            Depth: {
                type: 'vector',
                _legend: [
                    { shape: 'continuous', color: '#ffffff', value: '100 m' },
                    { shape: 'continuous', color: '#888888', value: '50 m' },
                    { shape: 'continuous', color: '#000000', value: '0 m' },
                ],
            },
        })

        const legend = await providers['layers:getLegend']('Depth')

        expect(legend.stops).toEqual(['#000000', '#888888', '#ffffff'])
        expect(legend.min).toBe(0)
        expect(legend.max).toBe(100)
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
