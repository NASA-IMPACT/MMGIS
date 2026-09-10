import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    resolveDataCoverage,
    parseRequestedWindow,
    evaluateLayerDataCoverage,
    isCoverageGated,
    isSameCoverage,
} from '../../src/essence/Basics/TimeControl_/layerDataCoverage.js'

/**
 * The core's one reading of a layer's declared data coverage. The timezone
 * is pinned behind UTC so a resolver that snapped days in local time would
 * surface as a wrong day here rather than only for a viewer in the Americas.
 * `vi.hoisted` runs before the imports above whatever its position in the
 * file, so the module under test loads with the offset already set.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/Los_Angeles'
})

const ms = (iso) => new Date(iso).getTime()

afterEach(() => {
    vi.restoreAllMocks()
})

const span = (start, end, at, unit) => ({
    start: ms(start),
    end: ms(end),
    at: ms(at),
    unit,
})

const listed = (...entries) =>
    resolveDataCoverage({ enabled: true, dataDates: entries })

describe('resolveDataCoverage', () => {
    test('is null for a layer that is not time-enabled', () => {
        expect(
            resolveDataCoverage({
                enabled: false,
                dataStartTime: '2020-01-01T00:00:00Z',
            })
        ).toBeNull()
    })

    test('is null when no coverage is declared', () => {
        expect(resolveDataCoverage({ enabled: true })).toBeNull()
        expect(resolveDataCoverage(undefined)).toBeNull()
    })
})

/**
 * A listed entry covers the whole unit it names — a year, a month, a day or
 * an hour — and keeps one timestamp, with any part left out
 * filled with its start. The hour is the finest unit: the timeline steps no
 * finer, so an entry written to the minute covers its hour but keeps its
 * exact time as the place navigation lands.
 */
describe('resolveDataCoverage over listed entries', () => {
    test('covers a whole year', () => {
        expect(listed('2020').spans).toEqual([
            span('2020-01-01T00:00:00Z', '2020-12-31T23:59:59.999Z', '2020-01-01T00:00:00Z', 'year'),
        ])
    })

    test('covers a whole month, to its true last day', () => {
        expect(listed('2020-02').spans).toEqual([
            span('2020-02-01T00:00:00Z', '2020-02-29T23:59:59.999Z', '2020-02-01T00:00:00Z', 'month'),
        ])
    })

    test('covers a whole day', () => {
        expect(listed('2020-03-04').spans).toEqual([
            span('2020-03-04T00:00:00Z', '2020-03-04T23:59:59.999Z', '2020-03-04T00:00:00Z', 'day'),
        ])
    })

    test('reads the other ISO day forms as days', () => {
        const day = span('2020-03-04T00:00:00Z', '2020-03-04T23:59:59.999Z', '2020-03-04T00:00:00Z', 'day')
        expect(listed('20200304').spans).toEqual([day])
        expect(listed('2020-064').spans).toEqual([day])
    })

    test('covers a whole hour', () => {
        expect(listed('2020-03-04T14').spans).toEqual([
            span('2020-03-04T14:00:00Z', '2020-03-04T14:59:59.999Z', '2020-03-04T14:00:00Z', 'hour'),
        ])
    })

    test('covers the hour of a time given to the minute, keeping the exact time', () => {
        expect(listed('2020-03-04T14:30').spans).toEqual([
            span('2020-03-04T14:00:00Z', '2020-03-04T14:59:59.999Z', '2020-03-04T14:30:00Z', 'hour'),
        ])
        expect(listed('2020-03-04T14:30:15.250Z').spans[0].at).toBe(
            ms('2020-03-04T14:30:15.250Z')
        )
    })

    test('reads a time given with an offset in UTC', () => {
        expect(listed('2020-03-04T09:30-05:00').spans).toEqual([
            span('2020-03-04T14:00:00Z', '2020-03-04T14:59:59.999Z', '2020-03-04T14:30:00Z', 'hour'),
        ])
    })

    // Each listed entry is its own place to move the timeline to, so a month
    // and a day inside it are both served.
    test('keeps an entry nested inside another', () => {
        expect(listed('2020-03', '2020-03-04').spans.map((s) => s.unit)).toEqual([
            'month',
            'day',
        ])
    })

    test('keeps two times in one hour as two entries', () => {
        expect(
            listed('2020-03-04T14:45Z', '2020-03-04T14:05Z').spans.map((s) => s.at)
        ).toEqual([ms('2020-03-04T14:05:00Z'), ms('2020-03-04T14:45:00Z')])
    })

    test('merges an entry listed twice', () => {
        expect(listed('2020-03-04', '2020-03-04', ' 2020-03-04 ').spans).toHaveLength(1)
    })

    test('orders entries by where they start, then by their timestamp', () => {
        const coverage = listed('2020-07-19', '2020-03-04T00:30Z', '2020-03-04', '2020-03')
        expect(coverage.spans.map((s) => s.unit)).toEqual(['month', 'day', 'hour', 'day'])
    })

    test('drops an entry it cannot read without losing the others', () => {
        expect(listed('2020-03-04', 'not-a-date', '2020-3-4', 'March 2020').spans).toHaveLength(1)
    })

    test('accepts dataDates as a single bare string', () => {
        const coverage = resolveDataCoverage({ enabled: true, dataDates: '2020-03' })

        expect(coverage.kind).toBe('sparse')
        expect(coverage.spans).toHaveLength(1)
    })

    test('lets listed entries win over a configured extent', () => {
        const coverage = resolveDataCoverage({
            enabled: true,
            dataStartTime: '2020-01-01T00:00:00Z',
            dataEndTime: '2020-12-31T00:00:00Z',
            dataDates: ['2020-03-04'],
        })

        expect(coverage.kind).toBe('sparse')
        expect(coverage.spans).toHaveLength(1)
    })
})

/**
 * The extent follows the same rule: a start runs from the beginning of the
 * unit it names, and an end runs to the close of its unit.
 */
describe('resolveDataCoverage over an extent', () => {
    const extent = (dataStartTime, dataEndTime) =>
        resolveDataCoverage({ enabled: true, dataStartTime, dataEndTime })

    test('runs a month-only end to the close of that month', () => {
        expect(extent('2020-01', '2020-03').spans).toEqual([
            { start: ms('2020-01-01T00:00:00Z'), end: ms('2020-03-31T23:59:59.999Z') },
        ])
    })

    test('reads a start and end naming the same day as that whole day', () => {
        expect(extent('2020-03-04', '2020-03-04').spans).toEqual([
            { start: ms('2020-03-04T00:00:00Z'), end: ms('2020-03-04T23:59:59.999Z') },
        ])
    })

    test('widens bounds given to the minute to their hours', () => {
        expect(extent('2020-03-04T14:30Z', '2020-03-04T16:10Z').spans).toEqual([
            { start: ms('2020-03-04T14:00:00Z'), end: ms('2020-03-04T16:59:59.999Z') },
        ])
    })

    test('falls back to the extent when nothing listed is readable', () => {
        const coverage = resolveDataCoverage({
            enabled: true,
            dataStartTime: '2020-01-01',
            dataEndTime: '2020-12-31',
            dataDates: ['March 4th', ''],
        })

        expect(coverage.kind).toBe('continuous')
        expect(coverage.spans).toEqual([
            { start: ms('2020-01-01T00:00:00Z'), end: ms('2020-12-31T23:59:59.999Z') },
        ])
    })

    test('leaves an absent bound open', () => {
        expect(extent('2020-01-01', undefined).spans).toEqual([
            { start: ms('2020-01-01T00:00:00Z'), end: Infinity },
        ])
        expect(extent(undefined, '2020-12-31').spans).toEqual([
            { start: -Infinity, end: ms('2020-12-31T23:59:59.999Z') },
        ])
    })

    test('leaves an unparseable bound open', () => {
        expect(extent('yesterday', '2020-12-31').spans[0].start).toBe(-Infinity)
    })

    // Configs carry bounds in looser formats than ISO 8601; those are read as
    // the exact instant they name.
    test('reads a bound that is not ISO 8601 as the instant it names', () => {
        const coverage = extent('2020/01/01 00:00:00 UTC', '2020/12/31 00:00:00 UTC')

        expect(coverage.kind).toBe('continuous')
        expect(coverage.spans).toEqual([
            { start: ms('2020-01-01T00:00:00Z'), end: ms('2020-12-31T00:00:00Z') },
        ])
    })

    test("resolves dataEndTime 'now' to the current instant", () => {
        vi.spyOn(Date, 'now').mockReturnValue(ms('2026-06-01T12:00:00Z'))

        expect(extent('2020-01-01', 'now').spans[0].end).toBe(
            ms('2026-06-01T12:00:00Z')
        )
    })

    test('treats an inverted extent as no coverage and warns', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(extent('2020-12-31', '2020-01-01')).toBeNull()
        expect(warn).toHaveBeenCalledTimes(1)
    })
})

/**
 * Coverage is resolved for every time-enabled layer on every time step, and
 * a layer may list years of dates, so the resolution is kept per config and
 * only redone when the config it was read from changes.
 */
describe('resolveDataCoverage caching', () => {
    test('resolves a config once', () => {
        const time = { enabled: true, dataDates: ['2020-03-04', '2020-07-19'] }

        expect(resolveDataCoverage(time).spans).toBe(
            resolveDataCoverage(time).spans
        )
    })

    test('resolves again when the listed entries change', () => {
        const time = { enabled: true, dataDates: ['2020-03-04'] }
        const first = resolveDataCoverage(time)

        time.dataDates = ['2020-03-04', '2020-07-19']

        expect(resolveDataCoverage(time).spans).toHaveLength(2)
        expect(first.spans).toHaveLength(1)
    })

    test('resolves again when an extent bound changes', () => {
        const time = { enabled: true, dataStartTime: '2020-01-01' }
        resolveDataCoverage(time)

        time.dataEndTime = '2020-06-30'

        expect(resolveDataCoverage(time).spans[0].end).toBe(
            ms('2020-06-30T23:59:59.999Z')
        )
    })

    test('warns once for an inverted extent however often it is asked', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const time = {
            enabled: true,
            dataStartTime: '2020-12-31',
            dataEndTime: '2020-01-01',
        }

        resolveDataCoverage(time)
        resolveDataCoverage(time)

        expect(warn).toHaveBeenCalledTimes(1)
    })

    test("resolves a 'now' bound afresh on every call", () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(ms('2026-06-01T12:00:00Z'))
        const time = { enabled: true, dataStartTime: '2020-01-01', dataEndTime: 'now' }
        resolveDataCoverage(time)

        now.mockReturnValue(ms('2026-06-01T13:00:00Z'))

        expect(resolveDataCoverage(time).spans[0].end).toBe(
            ms('2026-06-01T13:00:00Z')
        )
    })
})

/**
 * Whether the gate may take a layer off the map at all. A controlled layer
 * is driven by an external caller and moves only when that caller reloads
 * it; a dynamicExtent layer fetches through its own extent subscription,
 * which the gate does not reach, so hiding it would cost visibility and save
 * nothing.
 */
describe('isCoverageGated', () => {
    test('gates an ordinary layer', () => {
        expect(isCoverageGated({ name: 'Plain' })).toBe(true)
    })

    test('does not gate a controlled layer unless the caller may touch it', () => {
        expect(isCoverageGated({ name: 'Driven', controlled: true })).toBe(false)
        expect(isCoverageGated({ name: 'Driven', controlled: true }, true)).toBe(true)
    })

    test('never gates a dynamicExtent layer', () => {
        const layer = { name: 'Extent', variables: { dynamicExtent: true } }
        expect(isCoverageGated(layer)).toBe(false)
        expect(isCoverageGated(layer, true)).toBe(false)
    })
})

const sparseLayer = (start, end) => ({
    name: 'Flood Days',
    time: {
        enabled: true,
        dataDates: ['2020-03-04T14:30:00Z', '2020-07-19T06:30:00Z'],
        start,
        end,
    },
})

describe('parseRequestedWindow', () => {
    test('reads the layer window as epoch milliseconds', () => {
        expect(
            parseRequestedWindow({
                start: '2020-03-01T00:00:00Z',
                end: '2020-03-02T00:00:00Z',
            })
        ).toEqual({
            start: ms('2020-03-01T00:00:00Z'),
            end: ms('2020-03-02T00:00:00Z'),
        })
    })

    test('is null when a bound is missing or unreadable', () => {
        expect(
            parseRequestedWindow({ start: '2020-03-01T00:00:00Z' })
        ).toBeNull()
        expect(
            parseRequestedWindow({
                start: 'soon',
                end: '2020-03-02T00:00:00Z',
            })
        ).toBeNull()
        expect(parseRequestedWindow(undefined)).toBeNull()
    })
})

const hasData = (layer) => !evaluateLayerDataCoverage(layer).outOfDataRange

describe('evaluateLayerDataCoverage verdict', () => {
    test('is false for a window lying between two listed hours', () => {
        expect(
            hasData(
                sparseLayer('2020-04-01T00:00:00Z', '2020-05-01T00:00:00Z')
            )
        ).toBe(false)
    })

    // The whole hour counts, not only the listed minute: an hour is the
    // finest step the timeline takes.
    test('is true for a window inside a listed hour but short of its time', () => {
        expect(
            hasData(
                sparseLayer('2020-03-04T14:10:00Z', '2020-03-04T14:20:00Z')
            )
        ).toBe(true)
    })

    test('is false for a window starting just past a listed hour', () => {
        expect(
            hasData(
                sparseLayer('2020-03-04T15:00:00Z', '2020-03-04T16:00:00Z')
            )
        ).toBe(false)
    })

    test('counts a window ending exactly on a span start as overlapping', () => {
        expect(
            hasData(
                sparseLayer('2020-03-04T13:00:00Z', '2020-03-04T14:00:00.000Z')
            )
        ).toBe(true)
    })

    test('counts a window starting exactly on a span end as overlapping', () => {
        expect(
            hasData(
                sparseLayer('2020-03-04T14:59:59.999Z', '2020-03-04T16:00:00Z')
            )
        ).toBe(true)
    })

    test('is false outside a continuous extent and true inside it', () => {
        const layer = {
            name: 'NO2',
            time: {
                enabled: true,
                dataStartTime: '2020-01-01T00:00:00Z',
                dataEndTime: '2020-03-01T00:00:00Z',
                start: '2020-05-01T00:00:00Z',
                end: '2020-05-04T00:00:00Z',
            },
        }
        expect(hasData(layer)).toBe(false)

        layer.time.start = '2020-02-01T00:00:00Z'
        layer.time.end = '2020-02-04T00:00:00Z'
        expect(hasData(layer)).toBe(true)
    })

    test('is gated before a lone start bound and unconstrained after it', () => {
        const layer = {
            name: 'Ongoing',
            time: {
                enabled: true,
                dataStartTime: '2020-01-01T00:00:00Z',
                start: '2019-05-01T00:00:00Z',
                end: '2019-05-04T00:00:00Z',
            },
        }
        expect(hasData(layer)).toBe(false)

        layer.time.start = '2030-05-01T00:00:00Z'
        layer.time.end = '2030-05-04T00:00:00Z'
        expect(hasData(layer)).toBe(true)
    })

    // The gate may only suppress on positive evidence of absence.
    test('is true whenever it cannot tell', () => {
        expect(hasData({ name: 'No time' })).toBe(true)
        expect(
            hasData({
                name: 'No coverage',
                time: {
                    enabled: true,
                    start: '2020-01-01T00:00:00Z',
                    end: '2020-01-02T00:00:00Z',
                },
            })
        ).toBe(true)
        expect(
            hasData(sparseLayer(undefined, '2020-05-01T00:00:00Z'))
        ).toBe(true)
        expect(
            hasData(sparseLayer('garbage', '2020-05-01T00:00:00Z'))
        ).toBe(true)
    })
})

describe('evaluateLayerDataCoverage', () => {
    test('carries every fact a subscriber needs', () => {
        const record = evaluateLayerDataCoverage(
            sparseLayer('2020-04-01T00:00:00Z', '2020-05-01T00:00:00Z')
        )

        expect(record).toEqual({
            outOfDataRange: true,
            kind: 'sparse',
            spans: [
                span('2020-03-04T14:00:00Z', '2020-03-04T14:59:59.999Z', '2020-03-04T14:30:00Z', 'hour'),
                span('2020-07-19T06:00:00Z', '2020-07-19T06:59:59.999Z', '2020-07-19T06:30:00Z', 'hour'),
            ],
            requestedWindow: {
                start: ms('2020-04-01T00:00:00Z'),
                end: ms('2020-05-01T00:00:00Z'),
            },
        })
    })

    test('reports a layer with no coverage as never gated', () => {
        expect(
            evaluateLayerDataCoverage({
                name: 'Plain',
                time: { enabled: false },
            })
        ).toEqual({
            outOfDataRange: false,
            kind: null,
            spans: null,
            requestedWindow: null,
        })
    })
})

describe('isSameCoverage', () => {
    const base = () => ({
        outOfDataRange: true,
        kind: 'continuous',
        spans: [
            {
                start: ms('2020-01-01T00:00:00Z'),
                end: ms('2020-03-01T00:00:00Z'),
            },
        ],
        requestedWindow: {
            start: ms('2020-05-01T00:00:00Z'),
            end: ms('2020-05-04T00:00:00Z'),
        },
    })

    test('ignores the requested window', () => {
        const next = base()
        next.requestedWindow = {
            start: ms('2020-06-01T00:00:00Z'),
            end: ms('2020-06-04T00:00:00Z'),
        }
        expect(isSameCoverage(base(), next)).toBe(true)
    })

    test('sees a change of verdict', () => {
        const next = base()
        next.outOfDataRange = false
        expect(isSameCoverage(base(), next)).toBe(false)
    })

    test('sees a change of span bounds', () => {
        const next = base()
        next.spans[0].end = ms('2020-04-01T00:00:00Z')
        expect(isSameCoverage(base(), next)).toBe(false)
    })

    // A `dataEndTime: 'now'` layer resolves a fresh end on every step; at
    // minute granularity a scrub does not read as a stream of changes.
    test('treats span bounds within the same minute as equal', () => {
        const next = base()
        next.spans[0].end = base().spans[0].end + 45 * 1000
        expect(isSameCoverage(base(), next)).toBe(true)
    })

    // Two listed times in one hour share a span, so only their timestamps
    // tell a move within that hour apart — and navigation depends on them.
    test('sees a listed time move within the same hour', () => {
        const sparse = (at) => ({
            outOfDataRange: false,
            kind: 'sparse',
            spans: [
                span('2020-03-04T14:00:00Z', '2020-03-04T14:59:59.999Z', at, 'hour'),
            ],
            requestedWindow: null,
        })
        expect(
            isSameCoverage(
                sparse('2020-03-04T14:05:00Z'),
                sparse('2020-03-04T14:45:00Z')
            )
        ).toBe(false)
    })

    test('treats a missing previous record as different', () => {
        expect(isSameCoverage(undefined, base())).toBe(false)
        expect(isSameCoverage(null, base())).toBe(false)
    })
})
