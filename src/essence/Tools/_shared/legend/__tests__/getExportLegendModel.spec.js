import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

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

// The mission's own time.format lives in core; the model only asks core to
// apply it, so the fake here just marks that a timestamp went through it.
const formatted = (time) => `fmt(${time})`

const CURSOR = '2026-08-25T00:00:00Z'
const WINDOW_START = '2015-03-13T00:00:00Z'

beforeEach(() => {
    vi.mocked(getVisibleLayersWithLegends).mockReset()
    vi.mocked(resolveColormapColors).mockReset()
    vi.mocked(mmgisGetViewState).mockReset()
    vi.mocked(mmgisGetLayerConfigs).mockReset()
    vi.mocked(mmgisGetTimeStart).mockReset()
    vi.mocked(mmgisGetCurrentTime).mockReset()
    vi.mocked(mmgisGetCurrentTimeFormatted).mockReset()
    vi.mocked(mmgisGetTemporalExtents).mockReset()
    vi.mocked(mmgisFormatTime).mockReset()
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
                dateLine: null,
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
                dateLine: null,
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
            { kind: 'categorical', title: 'Classes', dateLine: null, stops },
        ])
    })

    // A layer with nothing to draw still belongs on the band: the band lists
    // what is on the map, and a layer without a ramp is still on the map.
    test('gives a layer with no graphics a plain row', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'Text layer', type: 'text' }),
            baseLayer({ title: 'None layer', type: 'none' }),
            baseLayer({
                title: 'Empty gradient',
                type: 'gradient',
                stops: [],
            }),
            baseLayer({
                title: 'Empty categorical',
                type: 'categorical',
                categoricalStops: [],
            }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([
            { kind: 'plain', title: 'Text layer', dateLine: null },
            { kind: 'plain', title: 'None layer', dateLine: null },
            { kind: 'plain', title: 'Empty gradient', dateLine: null },
            { kind: 'plain', title: 'Empty categorical', dateLine: null },
        ])
    })

    test('a plain row still carries its date line', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
            baseLayer({ id: 'basemap', title: 'Basemap', type: 'none' }),
        ])
        vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
            basemap: { start: '2016-01-01T00:00:00Z', end: null },
        })
        const model = await getExportLegendModel()
        expect(model.rows[0]).toEqual({
            kind: 'plain',
            title: 'Basemap',
            dateLine: `Collected from ${formatted('2016-01-01T00:00:00Z')}`,
        })
    })

    test('is an empty model when nothing qualifies', async () => {
        vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([])
        const model = await getExportLegendModel()
        expect(model.rows).toEqual([])
    })

    // Every date line names what kind of date it is, so a bare range can
    // never be read as a claim about when the pixels were collected.
    describe('date lines', () => {
        const gradientLayer = (id) =>
            baseLayer({
                id,
                title: id,
                type: 'gradient',
                stops: ['#a', '#b'],
            })

        const rowsFor = async (configs, layers) => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(
                layers ?? Object.keys(configs).map(gradientLayer),
            )
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(configs)
            const model = await getExportLegendModel()
            return model.rows
        }

        const templated =
            'https://host/{z}/{x}/{y}.png?datetime={starttime}/{endtime}'
        // Core appends `datetime=` to a STAC layer's URL itself, so a
        // time-enabled layer varies with the cursor with no placeholder in
        // sight — `time.enabled` is the only signal worth reading.
        const appended = 'stac-collection:no2-monthly'

        const requested = (start, cursor) =>
            `Requested ${formatted(start)} → ${formatted(cursor)}`

        test('a placeholder-free time-enabled layer still gets a date line', async () => {
            const rows = await rowsFor({
                stac: { url: appended, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(requested(WINDOW_START, CURSOR))
        })

        test('a layer with no time.type follows the cursor', async () => {
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true } },
            })
            expect(rows[0].dateLine).toBe(requested(WINDOW_START, CURSOR))
        })

        test('a local layer uses its own window and its own cursor', async () => {
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
            expect(rows[0].dateLine).toBe(
                requested('2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z'),
            )
        })

        // Point mode sets the window start to the epoch. "Requested 1970 →"
        // describes a span nobody asked for.
        test('an epoch window start prints an open-ended request', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1970-01-01T00:00:00Z',
            )
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(`Requested up to ${formatted(CURSOR)}`)
        })

        // Point mode rebuilds the epoch from local date components, so east
        // of Greenwich the start lands hours into 1970 rather than on it.
        test('an epoch window start east of UTC is still open-ended', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1970-01-01T09:00:00Z',
            )
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(`Requested up to ${formatted(CURSOR)}`)
        })

        // ...and west of it, where that same shifted epoch lands in 1969.
        test('an epoch window start west of UTC is still open-ended', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1969-12-31T19:00:00Z',
            )
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(`Requested up to ${formatted(CURSOR)}`)
        })

        // Only a start beside the epoch is Point mode's doing. A window a
        // user really set decades ago is a span they asked for, so print it.
        test('a window start decades before the epoch is printed', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(
                '1950-01-01T00:00:00Z',
            )
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(
                requested('1950-01-01T00:00:00Z', CURSOR),
            )
        })

        test('a missing window start prints an open-ended request', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(null)
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBe(`Requested up to ${formatted(CURSOR)}`)
        })

        test('no cursor and no window means no date line', async () => {
            vi.mocked(mmgisGetTimeStart).mockResolvedValue(null)
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(null)
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows[0].dateLine).toBeNull()
        })

        test('a monthly layer shows the calendar month holding the cursor', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-06-15T09:00:00Z',
            )
            const rows = await rowsFor({
                monthly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P1M' },
                },
            })
            expect(rows[0].dateLine).toBe('Showing 2025-06')
        })

        test('a yearly and a daily layer label just as compactly', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-06-15T09:00:00Z',
            )
            const rows = await rowsFor({
                yearly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P1Y' },
                },
                daily: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P1D' },
                },
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                'Showing 2025',
                'Showing 2025-06-15',
            ])
        })

        // A calendar label is the period itself, not a mission-formatted
        // timestamp, so it never goes through core's formatter.
        test('a calendar label is not sent to the time formatter', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-06-15T09:00:00Z',
            )
            await rowsFor({
                monthly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P1M' },
                },
            })
            const formatterArgs = vi
                .mocked(mmgisFormatTime)
                .mock.calls.map(([time]) => time)
            expect(formatterArgs).not.toContain('2025-06-15T09:00:00Z')
        })

        // The period ends where the next one starts, so the printed end is
        // its last second: a P7D period must read as seven days, not eight.
        test('an off-calendar interval anchors on the layer data start time', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-01-10T06:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                weekly: { start: '2025-01-01T00:00:00Z', end: null },
            })
            const rows = await rowsFor({
                weekly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P7D' },
                },
            })
            expect(rows[0].dateLine).toBe(
                `Showing ${formatted('2025-01-08T00:00:00.000Z')} → ${formatted(
                    '2025-01-14T23:59:59.000Z',
                )}`,
            )
        })

        // Half a range is worse than none: an end core cannot render drops
        // the whole Showing line rather than printing a dangling arrow.
        test('an unformattable period end falls back to the request', async () => {
            vi.mocked(mmgisGetCurrentTime).mockResolvedValue(
                '2025-01-10T06:00:00Z',
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                weekly: { start: '2025-01-01T00:00:00Z', end: null },
            })
            vi.mocked(mmgisFormatTime).mockImplementation(async (time) =>
                time == null || time === '2025-01-14T23:59:59.000Z'
                    ? null
                    : formatted(time),
            )
            const rows = await rowsFor({
                weekly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P7D' },
                },
            })
            expect(rows[0].dateLine).toBe(
                requested(WINDOW_START, '2025-01-10T06:00:00Z'),
            )
        })

        test('an off-calendar interval with nothing to anchor on falls back to the request', async () => {
            const rows = await rowsFor({
                weekly: {
                    url: appended,
                    time: { enabled: true, type: 'global', interval: 'P7D' },
                },
            })
            expect(rows[0].dateLine).toBe(requested(WINDOW_START, CURSOR))
        })

        test('an unparseable interval falls back to the request', async () => {
            const rows = await rowsFor({
                odd: {
                    url: appended,
                    time: {
                        enabled: true,
                        type: 'global',
                        interval: 'every month or so',
                    },
                },
            })
            expect(rows[0].dateLine).toBe(requested(WINDOW_START, CURSOR))
        })

        test('a layer that is not time-enabled shows its authored extent', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                fixed: {
                    start: '2016-05-01T00:00:00Z',
                    end: '2016-09-01T00:00:00Z',
                },
            })
            const rows = await rowsFor({
                fixed: {
                    url: 'https://host/{z}/{x}/{y}.png',
                    time: { enabled: false },
                },
            })
            expect(rows[0].dateLine).toBe(
                `Collected ${formatted('2016-05-01T00:00:00Z')} → ${formatted(
                    '2016-09-01T00:00:00Z',
                )}`,
            )
        })

        test('a half-open extent reads as open-ended, not as a range', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                fromOnly: { start: '2016-05-01T00:00:00Z', end: null },
                untilOnly: { start: null, end: '2016-09-01T00:00:00Z' },
                neither: { start: null, end: null },
            })
            const rows = await rowsFor({
                fromOnly: { url: 'https://host/a' },
                untilOnly: { url: 'https://host/b' },
                neither: { url: 'https://host/c' },
            })
            expect(rows.map((row) => row.dateLine)).toEqual([
                `Collected from ${formatted('2016-05-01T00:00:00Z')}`,
                `Collected until ${formatted('2016-09-01T00:00:00Z')}`,
                null,
            ])
        })

        test('a layer with no extent at all gets no date line', async () => {
            const rows = await rowsFor({
                plainOld: { url: 'https://host/{z}/{x}/{y}.png' },
            })
            expect(rows[0].dateLine).toBeNull()
        })

        // The cursor's own window is shared by every following layer, so it
        // is formatted once however many rows read it.
        test('the same timestamp is only sent to core once', async () => {
            await rowsFor({
                a: { url: templated, time: { enabled: true, type: 'global' } },
                b: { url: templated, time: { enabled: true, type: 'global' } },
            })
            const times = vi
                .mocked(mmgisFormatTime)
                .mock.calls.map(([time]) => time)
            expect(times.filter((time) => time === WINDOW_START)).toHaveLength(1)
            expect(times.filter((time) => time === CURSOR)).toHaveLength(1)
        })

        test('asks core for every layer extent in one call', async () => {
            await rowsFor({
                a: { url: 'https://host/a' },
                b: { url: 'https://host/b' },
            })
            expect(vi.mocked(mmgisGetTemporalExtents).mock.calls).toEqual([[]])
        })

        test('a null from the formatter gets no date line and no crash', async () => {
            vi.mocked(mmgisFormatTime).mockResolvedValue(null)
            const rows = await rowsFor({
                live: { url: templated, time: { enabled: true, type: 'global' } },
            })
            expect(rows).toHaveLength(1)
            expect(rows[0].dateLine).toBeNull()
        })

        test('a throwing time bus leaves the rows intact without a date line', async () => {
            vi.mocked(mmgisGetTimeStart).mockRejectedValue(new Error('no time'))
            vi.mocked(mmgisGetCurrentTime).mockRejectedValue(
                new Error('no time'),
            )
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                fixed: {
                    start: '2016-05-01T00:00:00Z',
                    end: '2016-09-01T00:00:00Z',
                },
            })
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
                // The untimed branch has to catch its own rejection too, or
                // the whole band goes down with the one row that failed.
                fixed: { url: templated, time: { enabled: false } },
            })
            expect(rows.map((row) => row.dateLine)).toEqual([null, null, null])
        })

        test('a throwing extent sweep leaves the rows intact', async () => {
            vi.mocked(mmgisGetTemporalExtents).mockRejectedValue(
                new Error('no extents'),
            )
            const rows = await rowsFor({
                fixed: { url: templated, time: { enabled: false } },
            })
            expect(rows.map((row) => row.dateLine)).toEqual([null])
        })

        test('a layer core has no config for is read as untimed', async () => {
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue([
                gradientLayer('orphan'),
            ])
            vi.mocked(mmgisGetLayerConfigs).mockResolvedValue(null)
            vi.mocked(mmgisGetTemporalExtents).mockResolvedValue({
                orphan: { start: '2016-05-01T00:00:00Z', end: null },
            })
            const model = await getExportLegendModel()
            expect(model.rows[0].dateLine).toBe(
                `Collected from ${formatted('2016-05-01T00:00:00Z')}`,
            )
        })
    })

    describe('the header', () => {
        const anyRow = () => [
            baseLayer({ type: 'gradient', stops: ['#a', '#b'] }),
        ]

        beforeEach(() => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-09-02T18:30:00Z'))
            vi.mocked(getVisibleLayersWithLegends).mockResolvedValue(anyRow())
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        test('prints the cursor and the export time under the mission name', async () => {
            vi.mocked(mmgisGetCurrentTimeFormatted).mockResolvedValue(
                'Sol 1234',
            )
            const model = await getExportLegendModel()
            expect(model.missionName).toBe('Test Mission')
            expect(model.headerLines).toEqual([
                'Time cursor Sol 1234',
                `Exported ${formatted('2026-09-02T18:30:00.000Z')}`,
            ])
        })

        test('leaves the cursor line out when core has no cursor to give', async () => {
            vi.mocked(mmgisGetCurrentTimeFormatted).mockResolvedValue(null)
            const model = await getExportLegendModel()
            expect(model.headerLines).toEqual([
                `Exported ${formatted('2026-09-02T18:30:00.000Z')}`,
            ])
        })

        // The export time is the one date always worth having, so an
        // unformattable one prints raw rather than vanishing.
        test('falls back to the raw ISO export time when core cannot format it', async () => {
            vi.mocked(mmgisFormatTime).mockResolvedValue(null)
            const model = await getExportLegendModel()
            expect(model.headerLines).toEqual([
                'Exported 2026-09-02T18:30:00.000Z',
            ])
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
