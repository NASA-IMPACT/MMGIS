import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../getVisibleLayersWithLegends', () => ({
    getVisibleLayersWithLegends: vi.fn(),
}))
vi.mock('../resolveColormapColors', () => ({
    resolveColormapColors: vi.fn(),
}))
vi.mock('../../adapters/mmgisAPI', () => ({
    mmgisGetViewState: vi.fn(),
    mmgisIsTimeEnabled: vi.fn(),
}))

import { getVisibleLayersWithLegends } from '../getVisibleLayersWithLegends'
import { resolveColormapColors } from '../resolveColormapColors'
import { mmgisGetViewState, mmgisIsTimeEnabled } from '../../adapters/mmgisAPI'
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

beforeEach(() => {
    vi.mocked(getVisibleLayersWithLegends).mockReset()
    vi.mocked(resolveColormapColors).mockReset()
    vi.mocked(mmgisGetViewState).mockReset()
    vi.mocked(mmgisIsTimeEnabled).mockReset()
    vi.mocked(mmgisGetViewState).mockResolvedValue({
        missionName: 'Test Mission',
        time: null,
        center: null,
        zoom: null,
    })
    vi.mocked(mmgisIsTimeEnabled).mockResolvedValue(false)
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
            { kind: 'categorical', title: 'Classes', stops },
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

    test('timeLabel is null when time is disabled, even with a time value', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        vi.mocked(mmgisGetViewState).mockResolvedValue({
            missionName: 'M',
            time: '2024-01-01T00:00:00Z',
            center: null,
            zoom: null,
        })
        vi.mocked(mmgisIsTimeEnabled).mockResolvedValue(false)
        const model = await getExportLegendModel()
        expect(model.timeLabel).toBeNull()
    })

    test('timeLabel is null when time is enabled but no time is available', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        vi.mocked(mmgisGetViewState).mockResolvedValue({
            missionName: 'M',
            time: null,
            center: null,
            zoom: null,
        })
        vi.mocked(mmgisIsTimeEnabled).mockResolvedValue(true)
        const model = await getExportLegendModel()
        expect(model.timeLabel).toBeNull()
    })

    test('timeLabel is set when time is enabled and available', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        vi.mocked(mmgisGetViewState).mockResolvedValue({
            missionName: 'M',
            time: '2024-01-01T00:00:00Z',
            center: null,
            zoom: null,
        })
        vi.mocked(mmgisIsTimeEnabled).mockResolvedValue(true)
        const model = await getExportLegendModel()
        expect(model.timeLabel).toBe('2024-01-01T00:00:00Z')
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
})
