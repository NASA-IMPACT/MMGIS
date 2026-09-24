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
    mmgisGetTimeMode: vi.fn(),
    mmgisGetTimeCurrentFormatted: vi.fn(),
    mmgisGetTemporalExtents: vi.fn(),
    mmgisGetDataCoverage: vi.fn(),
    mmgisFormatTime: vi.fn(),
}))

import { getLayersWithLegends } from '../getLayersWithLegends'
import {
    mmgisGetViewState,
    mmgisGetLayerConfigs,
    mmgisGetTimeStart,
    mmgisGetTimeCurrent,
    mmgisGetTimeMode,
    mmgisGetTimeCurrentFormatted,
    mmgisGetTemporalExtents,
    mmgisGetDataCoverage,
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

// A layer's interval as `layers:getTemporalExtent` answers it, already
// parsed by core.
const interval = (units) => ({
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    ...units,
})
const YEARLY = interval({ years: 1 })
const MONTHLY = interval({ months: 1 })
const WEEKLY = interval({ weeks: 1 })
const DAILY = interval({ days: 1 })

// A layer's `layers:getDataCoverage` record: the window core stamped on it,
// in epoch milliseconds, and whether that window is one whole period.
const record = ({ start, end, periodic, outOfDataRange = false }) => ({
    outOfDataRange,
    kind: 'continuous',
    spans: null,
    requestedWindow: { start: Date.parse(start), end: Date.parse(end) },
    periodic,
})

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
    vi.mocked(mmgisGetTimeMode).mockResolvedValue('range')
    vi.mocked(mmgisGetTimeCurrentFormatted).mockResolvedValue(null)
    vi.mocked(mmgisGetTemporalExtents).mockResolvedValue(null)
    vi.mocked(mmgisGetDataCoverage).mockResolvedValue(null)
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
        // Only the layers the user has toggled on are asked for, and the
        // configs this side already holds are handed on rather than fetched
        // a second time.
        expect(vi.mocked(getLayersWithLegends).mock.calls).toEqual([
            [{ showOnlyVisible: true, layerConfigs: null }],
        ])
    })

    // Every dated line names what kind of date it is, so a bare range can
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
        const timeEnabled = (time = {}) => ({
            url: 'stac-collection:no2-monthly',
            time: { enabled: true, type: 'global', ...time },
        })

        // Nothing says the server had data inside the span, so the line says
        // what was asked for rather than what came back.
        test('a time-enabled layer with no coverage prints the requested span', async () => {
            const rows = await rowsFor({ stac: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2015-03-13 → 2026-08-25')
        })

        // Point mode pins the window start to the epoch. "Requested 1970 →"
        // describes a span nobody asked for.
        test('point mode prints an open-ended request', async () => {
            vi.mocked(mmgisGetTimeMode).mockResolvedValue('point')
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1970-01-01T00:00:00Z',
            )
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested up to 2026-08-25')
        })

        // Only the mode says a start is a placeholder: a window that really
        // opens in 1970 is a bound the request ran from.
        test('a 1970 window start in range mode prints as a real start', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1970-01-01T05:00:00Z',
            )
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 1970-01-01 → 2026-08-25')
        })

        // With no Time UI bar mounted there is no mode, and the window start
        // is taken as given.
        test('no mode reads the window start as given', async () => {
            vi.mocked(mmgisGetTimeMode).mockResolvedValue(null)
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2015-03-13 → 2026-08-25')
        })

        // A mode request that fails costs the row nothing but the mode.
        test('a failed mode request reads the window start as given', async () => {
            vi.mocked(mmgisGetTimeMode).mockRejectedValue(new Error('no mode'))
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2015-03-13 → 2026-08-25')
            warn.mockRestore()
        })

        // Core requested one whole day for a periodic daily layer and stamped
        // its end on the day's last second, so at day precision the period
        // reads as the one day it is.
        test('a periodic daily layer whose period is covered prints the day', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                daily: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2026-01-01T00:00:00Z',
                    interval: DAILY,
                },
            })
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                daily: record({
                    start: '2025-06-15T00:00:00Z',
                    end: '2025-06-15T23:59:59Z',
                    periodic: true,
                }),
            })
            const rows = await rowsFor({ daily: timeEnabled() })
            expect(rows[0].dateLine).toBe('Collected 2025-06-15')
        })

        // The period prints whole, never clipped to the coverage: core floors
        // a periodic extent's end to the last step's start, so the second
        // layer's coverage ending on 1 May says May is its last month, not
        // that its data stops on the first.
        test('a periodic monthly layer prints its month, unclipped', async () => {
            const may = {
                start: '2025-05-01T00:00:00Z',
                end: '2025-05-31T23:59:59Z',
                periodic: true,
            }
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                monthly: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2026-01-01T00:00:00Z',
                    interval: MONTHLY,
                },
                lastMonth: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2025-05-01T00:00:00Z',
                    interval: MONTHLY,
                },
            })
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                monthly: record(may),
                lastMonth: record(may),
            })
            const rows = await rowsFor({
                monthly: timeEnabled(),
                lastMonth: timeEnabled(),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2025-05',
                'Collected 2025-05',
            ])
        })

        // A period the coverage never reaches held nothing to draw, so the
        // row names only what was asked for.
        test('a periodic layer whose period misses the coverage prints the request', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                daily: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2016-01-01T00:00:00Z',
                    interval: DAILY,
                },
            })
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                daily: record({
                    start: '2014-06-15T00:00:00Z',
                    end: '2014-06-15T23:59:59Z',
                    periodic: true,
                }),
            })
            const rows = await rowsFor({ daily: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested 2014-06-15')
        })

        // A layer requesting the window prints the part of the coverage the
        // window could have returned, from core's record rather than the
        // Time Control getters.
        test('a non-periodic layer prints the overlap of its request and coverage', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                plain: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2016-12-31T00:00:00Z',
                    interval: null,
                },
            })
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                plain: record({
                    start: '2010-01-01T00:00:00Z',
                    end: '2015-06-01T00:00:00Z',
                    periodic: false,
                }),
            })
            const rows = await rowsFor({ plain: timeEnabled() })
            expect(rows[0].dateLine).toBe('Collected 2015-01-01 → 2015-06-01')
        })

        // Point mode's epoch start is a placeholder only for a layer
        // requesting the window. A periodic layer's start is the start of
        // its period, a real bound.
        test('point mode keeps a periodic layer\'s period start', async () => {
            vi.mocked(mmgisGetTimeMode).mockResolvedValue('point')
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                weekly: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2026-01-01T00:00:00Z',
                    interval: WEEKLY,
                },
            })
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                weekly: record({
                    start: '2025-06-09T00:00:00Z',
                    end: '2025-06-15T23:59:59Z',
                    periodic: true,
                }),
            })
            const rows = await rowsFor({ weekly: timeEnabled() })
            expect(rows[0].dateLine).toBe('Collected 2025-06-09 → 2025-06-15')
        })

        test('point mode drops a non-periodic layer\'s epoch start', async () => {
            vi.mocked(mmgisGetTimeMode).mockResolvedValue('point')
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                live: record({
                    start: '1970-01-01T00:00:00Z',
                    end: CURSOR,
                    periodic: false,
                }),
            })
            const rows = await rowsFor({ live: timeEnabled() })
            expect(rows[0].dateLine).toBe('Requested up to 2026-08-25')
        })

        // Without a record from core, the window stamped on the layer's own
        // config is the request, not the Time Control's.
        test('with no record, the layer\'s own stamped window is the request', async () => {
            const rows = await rowsFor({
                stamped: timeEnabled({
                    start: '2020-01-01T00:00:00Z',
                    end: '2020-06-01T00:00:00Z',
                }),
            })
            expect(rows[0].dateLine).toBe('Requested 2020-01-01 → 2020-06-01')
        })

        // Core hides a layer whose coverage the cursor sits outside, so it
        // paints nothing; a collection range beside it would name pixels that
        // are not there. The row stays, because the layer is still toggled on.
        const verdict = (outOfDataRange) => ({
            outOfDataRange,
            kind: 'continuous',
            spans: null,
            requestedWindow: null,
            periodic: false,
        })
        const parkPastCoverage = () => {
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
                yearly: { ...coverage, interval: YEARLY },
                plain: { ...coverage, interval: null },
            })
        }

        test('a cursor past the coverage says the layer has no data at the cursor', async () => {
            parkPastCoverage()
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                yearly: verdict(true),
                plain: verdict(true),
            })
            const rows = await rowsFor({
                yearly: timeEnabled(),
                plain: timeEnabled(),
            })
            expect(rows.map((row) => row.title)).toEqual(['yearly', 'plain'])
            expect(rows.map((row) => row.dateLine)).toEqual([
                'No data at cursor',
                'No data at cursor',
            ])
        })

        // Only core's verdict hides a row's range: a layer core says has data,
        // or one it has no verdict for, keeps the range the overlap gives.
        test('a layer core says has data, or gave no verdict for, keeps its collected range', async () => {
            parkPastCoverage()
            vi.mocked(mmgisGetDataCoverage).mockResolvedValue({
                yearly: verdict(false),
            })
            const rows = await rowsFor({
                yearly: timeEnabled(),
                plain: timeEnabled(),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2015 → 2016',
                'Collected 2015-01-01 → 2016-12-31',
            ])
        })

        test('a failed coverage request leaves the date lines to the ranges', async () => {
            parkPastCoverage()
            vi.mocked(mmgisGetDataCoverage).mockRejectedValue(
                new Error('no handler'),
            )
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const rows = await rowsFor({
                yearly: timeEnabled(),
                plain: timeEnabled(),
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Collected 2015 → 2016',
                'Collected 2015-01-01 → 2016-12-31',
            ])
            warn.mockRestore()
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

        // With no record from core and no window stamped on the layer, the
        // Time Control's window start and cursor are the request.
        test('with no record and no stamped window, the Time Control window is the request', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                vectors: {
                    start: '2015-01-01T00:00:00Z',
                    end: '2016-12-31T00:00:00Z',
                    interval: YEARLY,
                },
            })
            const rows = await rowsFor({
                vectors: {
                    url: 'vectors.geojson',
                    time: { enabled: true, type: 'local' },
                },
            })
            expect(rows[0].dateLine).toBe('Collected 2015 → 2016')
        })

        // A window stamped on the layer in Point mode opens on the same
        // epoch placeholder as the Time Control's.
        test('a stamped window in point mode prints an open-ended request', async () => {
            vi.mocked(mmgisGetTimeMode).mockResolvedValue('point')
            const rows = await rowsFor({
                vectors: {
                    url: 'vectors.geojson',
                    time: {
                        enabled: true,
                        type: 'local',
                        start: '1970-01-01T00:00:00Z',
                        end: '2020-06-01T00:00:00Z',
                    },
                },
            })
            expect(rows[0].dateLine).toBe('Requested up to 2020-06-01')
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
