import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../getLayersWithLegends', () => ({
    getLayersWithLegends: vi.fn(),
}))
// Only the handlers the model actually reaches for are mocked, so it would
// fail loudly if it started requesting anything else.
vi.mock('../../adapters/mmgisAPI', () => ({
    mmgisGetViewState: vi.fn(),
    mmgisGetLayerConfigs: vi.fn(),
    mmgisGetTimeStart: vi.fn(),
    mmgisGetTimeCurrent: vi.fn(),
    mmgisGetTimeCurrentFormatted: vi.fn(),
    mmgisGetTemporalExtents: vi.fn(),
    mmgisFormatTime: vi.fn(),
}))

import { getLayersWithLegends } from '../getLayersWithLegends'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeCurrent,
    mmgisGetTimeCurrentFormatted,
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
    ...overrides,
})

// Both header times go through the mission's own format, so this fake just
// marks that a timestamp went through core.
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
    vi.mocked(mmgisGetTimeCurrent).mockResolvedValue(CURSOR)
    vi.mocked(mmgisGetTimeCurrentFormatted).mockResolvedValue(null)
    vi.mocked(mmgisGetTemporalExtents).mockResolvedValue(null)
    vi.mocked(mmgisFormatTime).mockImplementation(async (time) =>
        time == null ? null : formatted(time),
    )
})

describe('getExportLegendModel', () => {
    // Core already resolved each layer's legend; the model only picks the
    // shape it draws as, and a layer with nothing to draw still gets its name
    // on the band.
    test('draws each layer as the legend core resolved for it', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Displacement',
                type: 'gradient',
                stops: ['#000', '#fff'],
                min: 0,
                max: 10,
                unit: { label: 'm' },
            }),
            baseLayer({
                title: 'Classes',
                type: 'categorical',
                categoricalStops: [{ color: '#abc', label: 'Rock' }],
            }),
            baseLayer({ title: 'Basemap', type: 'none' }),
            baseLayer({ title: 'Empty gradient', type: 'gradient', stops: [] }),
        ])
        expect((await getExportLegendModel()).rows).toEqual([
            {
                kind: 'gradient',
                title: 'Displacement',
                dateLine: null,
                colors: ['#000', '#fff'],
                min: 0,
                max: 10,
                unit: 'm',
            },
            {
                kind: 'categorical',
                title: 'Classes',
                dateLine: null,
                stops: [{ color: '#abc', label: 'Rock' }],
            },
            { kind: 'plain', title: 'Basemap', dateLine: null },
            { kind: 'plain', title: 'Empty gradient', dateLine: null },
        ])
    })

    // A layer turned all the way down paints nothing, so it says nothing. No
    // other test narrows the list — a layer that is toggled on is on the band,
    // wherever the map happens to be looking.
    test('drops a layer at zero opacity and keeps every other one', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({ id: 'faded', title: 'Faded', opacity: 0.2 }),
            baseLayer({ id: 'off', title: 'Invisible', opacity: 0 }),
            baseLayer({ id: 'far', title: 'Far away', opacity: 1 }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows.map((r) => r.title)).toEqual(['Faded', 'Far away'])
        // Only the layers the user has toggled on are asked for.
        expect(vi.mocked(getLayersWithLegends).mock.calls).toEqual([
            [{ showOnlyVisible: true }],
        ])
    })

    // Every date line names what kind of date it is, so a bare range can
    // never be read as a claim about when the pixels were collected.
    describe('date lines', () => {
        const rowsFor = async (configs) => {
            vi.mocked(getLayersWithLegends).mockResolvedValue(
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
        // screen was collected in it, and the whole period is what prints.
        // Core floors a periodic extent's end to the last step's start, so
        // the weekly layer's end — a Wednesday — is where its last week
        // begins, not where its data stops.
        test('a period holding the cursor is the range that prints', async () => {
            vi.mocked(mmgisGetTimeCurrent).mockResolvedValue(
                '2025-05-30T00:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                monthly: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2026-01-01T00:00:00Z',
                },
                weekly: {
                    start: '2025-01-01T00:00:00Z',
                    end: '2025-05-28T00:00:00Z',
                },
            })
            const rows = await rowsFor({
                monthly: timeEnabled('P1M'),
                weekly: timeEnabled('P7D'),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2025-05',
                'Collected 2025-05-28 → 2025-06-03',
            ])
        })

        // A cursor parked past everything the layer holds is no collection
        // date; what the request could have returned is the coverage, whether
        // or not the layer serves periods.
        test('a cursor past the coverage falls back to the covered part of the request', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '2010-01-01T00:00:00Z',
            )
            vi.mocked(mmgisGetTimeCurrent).mockResolvedValue(
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

        // The overlap reads an unreadable bound as unbounded, which would make
        // the request itself look like a collection range.
        test('coverage that will not parse is no coverage at all', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                garbled: { start: 'not-a-date', end: 'nope' },
            })
            const rows = await rowsFor({ garbled: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2015-03-13 → 2026-08-25')
        })

        // The server had nothing inside the span to draw, so the app cannot
        // say what, if anything, of the layer is on screen.
        test('a request that never meets the coverage prints what was asked for', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '2010-01-01T00:00:00Z',
            )
            vi.mocked(mmgisGetTimeCurrent).mockResolvedValue(
                '2014-01-01T00:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                later: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2016-01-01T00:00:00Z',
                },
            })
            const rows = await rowsFor({ later: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2010-01-01 → 2014-01-01')
        })

        // A 'local' layer carries its own window, but only once the dashboard
        // has stamped one on it; until then the global one is what its
        // features are filtered against.
        test('a local layer with no window of its own follows the global cursor', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                vectors: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2016-12-31T00:00:00Z',
                },
            })
            const rows = await rowsFor({
                vectors: {
                    url: 'vectors.geojson',
                    time: { enabled: true, type: 'local', interval: 'P1Y' },
                },
            })
            expect(rows[0].dateLine).toBe('Collected 2015 → 2016')
        })

        // A layer that ignores the time cursor prints the extent it holds, and
        // an extent open at one end reads as open rather than as a range.
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

        // Both ends of a span print at the same precision, so a span narrower
        // than that precision reads the same at both ends; `X → X` would only
        // look like a mistake.
        test('a span whose ends print alike says the date once', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '2026-08-25T01:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                oneDay: {
                    start: '2016-05-01T00:00:00Z',
                    end: '2016-05-01T23:59:59Z',
                },
            })
            const rows = await rowsFor({
                oneDay: { url: 'https://host/{z}/{x}/{y}.png' },
                oneRequest: timeEnabled(),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2016-05-01',
                'Requested 2026-08-25',
            ])
        })

        // A time bus that cannot answer costs the rows their dates, never the
        // band its rows.
        test('a throwing time bus leaves the rows intact', async () => {
            vi.mocked(mmgisGetTimeStart).mockRejectedValue(new Error('no time'))
            vi.mocked(mmgisGetTimeCurrent).mockRejectedValue(
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
            vi.mocked(getLayersWithLegends).mockResolvedValue([baseLayer({})])
            vi.mocked(mmgisGetTimeCurrentFormatted).mockResolvedValue('Sol 1234')
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

    // A mission without time has no cursor to name, and a time bus that
    // cannot answer costs the header a line, never the band its rows.
    test('a throwing time bus leaves the rows and the export line intact', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'Displacement' }),
        ])
        vi.mocked(mmgisGetTimeCurrentFormatted).mockRejectedValue(
            new Error('no time'),
        )
        const model = await getExportLegendModel()
        expect(model.rows.map((r) => r.title)).toEqual(['Displacement'])
        expect(model.headerLines).toHaveLength(1)
        expect(model.headerLines[0]).toMatch(/^Exported fmt\(/)
    })
})
