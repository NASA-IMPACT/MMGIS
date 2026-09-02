import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../getVisibleLayersWithLegends', () => ({
    getVisibleLayersWithLegends: vi.fn(),
}))
vi.mock('../resolveColormapColors', () => ({
    resolveColormapColors: vi.fn(),
}))
// Only the handlers the model actually reaches for are mocked, so importing
// it would fail loudly if it started requesting anything else — the viewport,
// the zoom, or the blocking whole-mission layers:getBounds sweep among them.
vi.mock('../../adapters/mmgisAPI', () => ({
    mmgisGetViewState: vi.fn(),
    mmgisGetLayerConfigs: vi.fn(),
    mmgisGetTimeStart: vi.fn(),
    mmgisGetTimeEnd: vi.fn(),
    mmgisFormatTime: vi.fn(),
}))

import { getVisibleLayersWithLegends } from '../getVisibleLayersWithLegends'
import { resolveColormapColors } from '../resolveColormapColors'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeEnd,
    mmgisFormatTime,
} from '../../adapters/mmgisAPI'
import { getExportLegendModel } from '../getExportLegendModel'

const baseLayer = (overrides) => ({
    id: 'layer',
    title: 'Layer',
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    ...overrides,
})

// The mission's own time.format lives in core; the model only asks core to
// apply it, so the fake here just marks that a timestamp went through it.
const formatted = (time) => `fmt(${time})`

beforeEach(() => {
    vi.mocked(getVisibleLayersWithLegends).mockReset()
    vi.mocked(resolveColormapColors).mockReset()
    vi.mocked(mmgisGetViewState).mockReset()
    vi.mocked(mmgisGetLayerConfigs).mockReset()
    vi.mocked(mmgisGetTimeStart).mockReset()
    vi.mocked(mmgisGetTimeEnd).mockReset()
    vi.mocked(mmgisFormatTime).mockReset()
    vi.mocked(mmgisGetViewState).mockResolvedValue({
        missionName: 'Test Mission',
        time: null,
        center: null,
        zoom: null,
    })
    vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(null)
    vi.mocked(mmgisGetTimeStart).mockResolvedValue('2015-03-13T00:00:00Z')
    vi.mocked(mmgisGetTimeEnd).mockResolvedValue('2026-08-25T00:00:00Z')
    vi.mocked(mmgisFormatTime).mockImplementation(async (time) =>
        time == null ? null : formatted(time),
    )
})

describe('getExportLegendModel', () => {
    test('an authored legend wins over a live cog colormap', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Displacement',
                type: 'gradient',
                stops: ['#a', '#b'],
                min: 0,
                max: 10,
                unit: { label: 'm' },
                cog: {
                    isCog: true,
                    editable: true,
                    colormap: 'viridis',
                    min: -5,
                    max: 5,
                    defaultMin: -5,
                    defaultMax: 5,
                    defaultColormap: 'viridis',
                    units: 'K',
                    titilerUrl: null,
                },
            }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([
            {
                kind: 'gradient',
                title: 'Displacement',
                timeRange: null,
                colors: ['#a', '#b'],
                min: 0,
                max: 10,
                unit: 'm',
            },
        ])
        expect(resolveColormapColors).not.toHaveBeenCalled()
    })

    test('falls back to the cog colormap when nothing is authored', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Raster',
                type: 'gradient',
                stops: null,
                cog: {
                    isCog: true,
                    editable: true,
                    colormap: 'magma',
                    min: 2,
                    max: 8,
                    defaultMin: 2,
                    defaultMax: 8,
                    defaultColormap: 'magma',
                    units: 'K',
                    titilerUrl: null,
                },
            }),
        ])
        vi.mocked(resolveColormapColors).mockResolvedValue(['#000', '#fff'])
        const model = await getExportLegendModel()
        expect(resolveColormapColors).toHaveBeenCalledWith('magma', null)
        expect(model.rows).toEqual([
            {
                kind: 'gradient',
                title: 'Raster',
                timeRange: null,
                colors: ['#000', '#fff'],
                min: 2,
                max: 8,
                unit: 'K',
            },
        ])
    })

    // The cog block's min/max already reflect current-over-config precedence
    // upstream, in buildLayerLegendData — this only checks pass-through.
    test('passes the cog block live min/max through unchanged', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Live',
                type: 'gradient',
                stops: null,
                cog: {
                    isCog: true,
                    editable: true,
                    colormap: 'rdbu_r',
                    min: -0.1,
                    max: 0.2,
                    defaultMin: 0,
                    defaultMax: 1,
                    defaultColormap: 'viridis',
                    units: null,
                    titilerUrl: null,
                },
            }),
        ])
        vi.mocked(resolveColormapColors).mockResolvedValue(['#000'])
        const model = await getExportLegendModel()
        expect(model.rows[0].min).toBe(-0.1)
        expect(model.rows[0].max).toBe(0.2)
    })

    test('builds a categorical row from categoricalStops', async () => {
        const stops = [
            { color: '#ff0000', label: 'water' },
            { color: '#0000ff', label: 'sky' },
        ]
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'Classes', type: 'categorical', categoricalStops: stops }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([
            { kind: 'categorical', title: 'Classes', timeRange: null, stops },
        ])
    })

    test('omits text and none layers', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'Text layer', type: 'text' }),
            baseLayer({ title: 'None layer', type: 'none' }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([])
    })

    test('is an empty model when nothing qualifies', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([])
    })

    // Each row carries the window its own layer answers to. A layer that does
    // not vary with time carries none: an absent claim is correct, a borrowed
    // one is not.
    describe('per-row time ranges', () => {
        const timedLayer = (id) =>
            baseLayer({
                id,
                title: id,
                type: 'gradient',
                stops: ['#a', '#b'],
            })

        const rowsFor = async (configs, layers) => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(
                layers ?? Object.keys(configs).map(timedLayer),
            )
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(configs)
            const model = await getExportLegendModel()
            return model.rows
        }

        const templated = 'https://host/{z}/{x}/{y}.png?datetime={starttime}/{endtime}'

        test('a layer without time gets no time text', async () => {
            const rows = await rowsFor({
                fixed: {
                    url: 'https://host/items/scene_2025-01-12/{z}/{x}/{y}.png',
                },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('a layer with time.enabled false gets no time text', async () => {
            const rows = await rowsFor({
                fixed: {
                    url: templated,
                    time: { enabled: false, type: 'global' },
                },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('a global layer gets the global window', async () => {
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].timeRange).toBe(
                `${formatted('2015-03-13T00:00:00Z')} → ${formatted(
                    '2026-08-25T00:00:00Z',
                )}`,
            )
        })

        test('a requery layer gets the global window too', async () => {
            const rows = await rowsFor({
                live: {
                    url: templated,
                    time: { enabled: true, type: 'requery' },
                },
            })
            expect(rows[0].timeRange).toBe(
                `${formatted('2015-03-13T00:00:00Z')} → ${formatted(
                    '2026-08-25T00:00:00Z',
                )}`,
            )
        })

        test('a local layer gets its own start and end', async () => {
            const rows = await rowsFor({
                own: {
                    url: templated,
                    time: {
                        enabled: true,
                        type: 'local',
                        start: '2020-01-01T00:00:00Z',
                        end: '2020-02-01T00:00:00Z',
                    },
                },
            })
            expect(rows[0].timeRange).toBe(
                `${formatted('2020-01-01T00:00:00Z')} → ${formatted(
                    '2020-02-01T00:00:00Z',
                )}`,
            )
        })

        // Time enabled, but nothing in the URL for core to substitute a time
        // into — the layer requests the same scene at every cursor position.
        test('a time-enabled layer with an untemplated URL gets no time text', async () => {
            const rows = await rowsFor({
                pinned: {
                    url: 'https://host/items/scene_2025-01-12/{z}/{x}/{y}.png',
                    time: { enabled: true, type: 'global' },
                },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('an unrecognized time type gets no time text', async () => {
            const rows = await rowsFor({
                odd: {
                    url: templated,
                    time: { enabled: true, type: 'somethingelse' },
                },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('a local layer missing an endpoint gets no time text, not half a range', async () => {
            const rows = await rowsFor({
                half: {
                    url: templated,
                    time: {
                        enabled: true,
                        type: 'local',
                        start: '2020-01-01T00:00:00Z',
                        end: null,
                    },
                },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('a null global window gets no time text', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(null)
            vi.mocked(mmgisGetTimeEnd).mockResolvedValue(null)
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].timeRange).toBeNull()
        })

        test('a null from the formatter gets no time text and no crash', async () => {
            vi.mocked(mmgisFormatTime).mockResolvedValue(null)
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows).toHaveLength(1)
            expect(rows[0].timeRange).toBeNull()
        })

        test('a throwing time bus leaves the rows intact without a range', async () => {
            vi.mocked(mmgisGetTimeStart).mockRejectedValue(new Error('no time'))
            vi.mocked(mmgisFormatTime).mockRejectedValue(new Error('bad format'))
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
                own: {
                    url: templated,
                    time: {
                        enabled: true,
                        type: 'local',
                        start: '2020-01-01T00:00:00Z',
                        end: '2020-02-01T00:00:00Z',
                    },
                },
            })
            expect(rows.map((row) => row.timeRange)).toEqual([null, null])
        })

        test('the same timestamp is only sent to core once', async () => {
            await rowsFor({
                a: { url: templated, time: { enabled: true, type: 'global' } },
                b: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(vi.mocked(mmgisFormatTime).mock.calls).toEqual([
                ['2015-03-13T00:00:00Z'],
                ['2026-08-25T00:00:00Z'],
            ])
        })

        test('a layer core has no config for gets no time text', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
                timedLayer('orphan'),
            ])
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(null)
            const model = await getExportLegendModel()
            expect(model.rows[0].timeRange).toBeNull()
        })
    })

    test('missing authored bounds pass through as null, not an empty string', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'No bounds',
                type: 'gradient',
                stops: ['#a', '#b'],
                unit: { label: 'm' },
            }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows[0].min).toBeNull()
        expect(model.rows[0].max).toBeNull()
    })

    test('renders no unit when neither the layer nor the cog names one', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Unitless',
                type: 'gradient',
                stops: null,
                cog: {
                    isCog: true,
                    editable: true,
                    colormap: 'viridis',
                    min: 0,
                    max: 1,
                    defaultMin: 0,
                    defaultMax: 1,
                    defaultColormap: 'viridis',
                    units: null,
                    titilerUrl: null,
                },
            }),
        ])
        vi.mocked(resolveColormapColors).mockResolvedValue(['#000'])
        const model = await getExportLegendModel()
        expect(model.rows[0].unit).toBeNull()
    })

    test('threads the fetched layerConfigs into getVisibleLayersWithLegends rather than refetching', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        const configs = { layer1: { display_name: 'Layer 1' } }
        vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(configs)
        await getExportLegendModel()
        expect(getVisibleLayersWithLegends).toHaveBeenCalledWith(
            expect.objectContaining({ layerConfigs: configs }),
        )
    })

    // A toggled-on layer gets a row. A configured boundingBox says nothing
    // reliable about where a layer paints — a collection mosaic paints
    // wherever its collection has data while its declared bbox describes one
    // granule, and a vector layer's deck.gl path reports that same configured
    // box — so no footprint, of any layer type, keeps a row out.
    describe('which layers get a row', () => {
        const twoLayers = [
            baseLayer({
                id: 'near',
                title: 'Near',
                type: 'gradient',
                stops: ['#a', '#b'],
            }),
            baseLayer({
                id: 'far',
                title: 'Far',
                type: 'gradient',
                stops: ['#a', '#b'],
            }),
        ]

        test('keeps a raster layer whose configured bounding box is nowhere near the map', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(twoLayers)
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue({
                near: { type: 'tile', boundingBox: [-58, -35, -53, -30] },
                // One granule over Nicaragua, on a mosaic painting over Uruguay.
                far: { type: 'tile', boundingBox: [-87, 11, -83, 15] },
            })
            const model = await getExportLegendModel()
            expect(model.rows.map((r) => r.title)).toEqual(['Near', 'Far'])
        })

        test('keeps a vector layer whose configured bounding box is nowhere near the map', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(twoLayers)
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue({
                near: { type: 'vector', boundingBox: [-58, -35, -53, -30] },
                far: { type: 'vector', boundingBox: [-87, 11, -83, 15] },
            })
            const model = await getExportLegendModel()
            expect(model.rows.map((r) => r.title)).toEqual(['Near', 'Far'])
        })

        test('keeps a layer configured well outside the current zoom range', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(twoLayers)
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue({
                near: { type: 'vector' },
                far: { type: 'vector', minZoom: 18, maxZoom: 20 },
            })
            const model = await getExportLegendModel()
            expect(model.rows.map((r) => r.title)).toEqual(['Near', 'Far'])
        })

        test('omits a fully transparent layer', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
                twoLayers[0],
                { ...twoLayers[1], opacity: 0 },
            ])
            const model = await getExportLegendModel()
            expect(model.rows.map((r) => r.title)).toEqual(['Near'])
        })
    })
})
