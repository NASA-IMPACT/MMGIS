import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../getVisibleLayersWithLegends', () => ({
    getVisibleLayersWithLegends: vi.fn(),
}))
vi.mock('../resolveColormapColors', () => ({
    resolveColormapColors: vi.fn(),
}))
// Only the handlers the model actually reaches for are mocked, so it would
// fail loudly if it started requesting anything else — the blocking
// whole-mission layers:getBounds sweep among them.
vi.mock('../../adapters/mmgisAPI', () => ({
    mmgisGetViewState: vi.fn(),
    mmgisGetLayerConfigs: vi.fn(),
    mmgisGetTimeStart: vi.fn(),
    mmgisGetCurrentTime: vi.fn(),
    mmgisGetCurrentTimeFormatted: vi.fn(),
    mmgisGetTemporalExtents: vi.fn(),
    mmgisFormatTime: vi.fn(),
}))

import { getVisibleLayersWithLegends } from '../getVisibleLayersWithLegends'
import { resolveColormapColors } from '../resolveColormapColors'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetCurrentTime,
    mmgisGetCurrentTimeFormatted,
    mmgisGetTemporalExtents,
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

const cogBlock = (overrides) => ({
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
    ...overrides,
})

// Only the header's export time goes through the mission's time.format, so
// this fake just marks that a timestamp went through core.
const formatted = (time) => `fmt(${time})`

const CURSOR = '2026-08-25T00:00:00Z'
const WINDOW_START = '2015-03-13T00:00:00Z'

beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(mmgisGetViewState).mockResolvedValue({
        missionName: 'Test Mission',
        time: null,
        center: null,
        zoom: null,
    })
    vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(null)
    vi.mocked(mmgisGetTimeStart).mockResolvedValue(WINDOW_START)
    vi.mocked(mmgisGetCurrentTime).mockResolvedValue(CURSOR)
    vi.mocked(mmgisGetCurrentTimeFormatted).mockResolvedValue(null)
    vi.mocked(mmgisGetTemporalExtents).mockResolvedValue(null)
    vi.mocked(mmgisFormatTime).mockImplementation(async (time) =>
        time == null ? null : formatted(time),
    )
})

describe('getExportLegendModel', () => {
    // The live cog colormap is only drawn when nobody authored a legend.
    test('an authored legend wins over a live cog colormap, which a bare layer falls back to', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Authored',
                type: 'gradient',
                stops: ['#a', '#b'],
                min: 0,
                max: 10,
                unit: { label: 'm' },
                cog: cogBlock(),
            }),
            baseLayer({
                title: 'Raster',
                type: 'gradient',
                stops: null,
                cog: cogBlock(),
            }),
        ])
        vi.mocked(resolveColormapColors).mockResolvedValue(['#000', '#fff'])
        const model = await getExportLegendModel()
        expect(
            model.rows.map((r) => [r.kind, r.title, r.colors, r.min, r.max, r.unit]),
        ).toEqual([
            ['gradient', 'Authored', ['#a', '#b'], 0, 10, 'm'],
            ['gradient', 'Raster', ['#000', '#fff'], 2, 8, 'K'],
        ])
        // Only the layer with nothing authored had a colormap to resolve.
        expect(vi.mocked(resolveColormapColors).mock.calls).toEqual([
            ['magma', null],
        ])
    })

    // A layer without a ramp is still on the map, so it still gets a row.
    test('gives a layer with no graphics a plain row', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'None layer', type: 'none' }),
            baseLayer({ title: 'Empty gradient', type: 'gradient', stops: [] }),
        ])
        expect((await getExportLegendModel()).rows).toEqual([
            { kind: 'plain', title: 'None layer', dateLine: null },
            { kind: 'plain', title: 'Empty gradient', dateLine: null },
        ])
    })

    // Every date line names what kind of date it is, so a bare range can
    // never be read as a claim about when the pixels were collected.
    describe('date lines', () => {
        const rowsFor = async (configs) => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(
                Object.keys(configs).map((id) =>
                    baseLayer({ id, title: id, type: 'none' }),
                ),
            )
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(configs)
            return (await getExportLegendModel()).rows
        }

        // Core appends `datetime=` itself, so a layer varies with the cursor
        // with no URL placeholder in sight: `time.enabled` is the signal.
        const timeEnabled = (interval) => ({
            url: 'stac-collection:no2-monthly',
            time: {
                enabled: true,
                type: 'global',
                ...(interval ? { interval } : {}),
            },
        })

        // Nothing says the server had data inside the span, so the line says
        // what was asked for rather than what came back.
        test('a time-enabled layer with no coverage prints the requested span', async () => {
            const rows = await rowsFor({ stac: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2015-03-13 → 2026-08-25')
        })

        // Point mode sets the window start to the epoch. "Requested 1970 →"
        // describes a span nobody asked for.
        test('an epoch window start prints an open-ended request', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1970-01-01T00:00:00Z',
            )
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested up to 2026-08-25')
        })

        // The cursor's period is inside the layer's coverage, so the data on
        // screen was collected in it — and where the coverage stops partway
        // through that period, the printed range stops there too rather than
        // naming days the layer has nothing for.
        test('a period holding the cursor is narrowed, then clipped to the coverage', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-01-10T00:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                monthly: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2026-01-01T00:00:00Z',
                },
                weekly: {
                    start: '2025-01-01T00:00:00Z',
                    end: '2025-01-09T23:59:59Z',
                },
            })
            const rows = await rowsFor({
                monthly: timeEnabled('P1M'),
                weekly: timeEnabled('P7D'),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2025-01',
                'Collected 2025-01-08 → 2025-01-09',
            ])
        })

        // A cursor parked past everything the layer holds is no collection
        // date; what the request could have returned is the coverage.
        test('a cursor past the coverage falls back to the covered part of the request', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '2010-01-01T00:00:00Z',
            )
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2024-05-01T00:00:00Z',
            )
            const coverage = {
                start: '2015-01-01T00:00:00Z',
                end: '2016-12-31T00:00:00Z',
            }
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                yearly: coverage,
                plain: coverage,
            })
            const rows = await rowsFor({
                yearly: timeEnabled('P1Y'),
                plain: timeEnabled(),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2015 → 2016',
                'Collected 2015-01-01 → 2016-12-31',
            ])
        })

        // A layer that ignores the slider prints the extent it holds, and an
        // extent open at one end reads as open rather than as a range.
        test('an untimed layer shows its authored extent, open ends and all', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                bounded: {
                    start: '2016-05-01T00:00:00Z',
                    end: '2016-09-01T00:00:00Z',
                },
                fromOnly: { start: '2016-05-01T00:00:00Z', end: null },
                untilOnly: { start: null, end: '2016-09-01T00:00:00Z' },
                neither: { start: null, end: null },
            })
            const untimed = { url: 'https://host/{z}/{x}/{y}.png' }
            const rows = await rowsFor({
                bounded: { ...untimed, time: { enabled: false } },
                fromOnly: untimed,
                untilOnly: untimed,
                neither: untimed,
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2016-05-01 → 2016-09-01',
                'Collected from 2016-05-01',
                'Collected until 2016-09-01',
                null,
            ])
        })

        // A time bus that cannot answer costs the rows their dates, never the
        // band its rows.
        test('a throwing time bus leaves the rows intact', async () => {
            vi.mocked(mmgisGetTimeStart).mockRejectedValue(new Error('no time'))
            vi.mocked(mmgisGetCurrentTime).mockRejectedValue(
                new Error('no time'),
            )
            vi.mocked(mmgisGetTemporalExtents).mockRejectedValue(
                new Error('no extents'),
            )
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows.map((row) => row.title)).toEqual(['live'])
            expect(rows[0].dateLine).toBeNull()
        })
    })

    test('prints the cursor and the export time under the mission name', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-02T18:30:00Z'))
        try {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
                baseLayer({ type: 'gradient', stops: ['#a', '#b'] }),
            ])
            vi.mocked(mmgisGetCurrentTimeFormatted).mockResolvedValue(
                'Sol 1234',
            )
            const model = await getExportLegendModel()
            expect(model.missionName).toBe('Test Mission')
            expect(model.headerLines).toEqual([
                'Time cursor Sol 1234',
                `Exported ${formatted('2026-09-02T18:30:00.000Z')}`,
            ])
        } finally {
            vi.useRealTimers()
        }
    })

    // A configured boundingBox says nothing reliable about where a layer
    // paints: a mosaic paints wherever its collection has data while its
    // declared bbox describes one granule. No footprint keeps a row out.
    test('keeps a layer whose configured footprint is nowhere near the map', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ id: 'near', title: 'Near', type: 'none' }),
            baseLayer({ id: 'far', title: 'Far', type: 'none' }),
        ])
        vi.mocked(mmgisGetLayerConfigs).mockResolvedValue({
            near: { type: 'tile', boundingBox: [-58, -35, -53, -30] },
            // One granule over Nicaragua, on a mosaic painting over Uruguay.
            far: {
                type: 'vector',
                boundingBox: [-87, 11, -83, 15],
                minZoom: 18,
            },
        })
        const model = await getExportLegendModel()
        expect(model.rows.map((r) => r.title)).toEqual(['Near', 'Far'])
    })
})
