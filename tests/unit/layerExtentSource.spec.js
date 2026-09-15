import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    readPath,
    applyExtentSource,
    fetchLayerExtentSource,
} from '../../src/essence/Basics/TimeControl_/layerExtentSource'

const STAC = {
    extent: { temporal: { interval: [['2020-01-01T00:00:00Z', null]] } },
    summaries: { datetime: ['2020-01', '2020-02'], cadence: 'P1M' },
    features: [
        { properties: { datetime: '2021-01-01T00:00:00Z' } },
        { properties: { datetime: '2021-02-01T00:00:00Z' } },
    ],
}

describe('layer extent source', () => {
    describe('readPath', () => {
        test.each([
            ['extent.temporal.interval.0.0', '2020-01-01T00:00:00Z'],
            ['summaries.cadence', 'P1M'],
            ['summaries.datetime', ['2020-01', '2020-02']],
            ['features.1.properties.datetime', '2021-02-01T00:00:00Z'],
            ['summaries. cadence', 'P1M'],
            [' summaries.cadence ', 'P1M'],
        ])('reads %s', (path, expected) => {
            expect(readPath(STAC, path)).toEqual(expected)
        })

        test('an array root is addressed by index', () => {
            expect(readPath([{ d: 'x' }], '0.d')).toBe('x')
        })

        test.each([
            ['missing.key'],
            ['summaries.datetime.5'],
            ['summaries.cadence.deeper'],
            ['extent.temporal.interval.0.1'],
            ['summaries..cadence'],
            ['summaries.'],
            [''],
            ['   '],
        ])('%s matches nothing', (path) => {
            expect(readPath(STAC, path)).toBeUndefined()
        })

        test('non-object roots match nothing', () => {
            expect(readPath(null, 'a')).toBeUndefined()
            expect(readPath('str', 'a')).toBeUndefined()
        })
    })

    describe('applyExtentSource', () => {
        const staticTime = () => ({
            enabled: true,
            dataStartTime: '2000-01-01T00:00:00Z',
            dataEndTime: 'now',
            interval: 'P1D',
            dataDates: ['2000-01-01'],
        })

        test('a mapped string overrides each field as written', () => {
            const time = {
                ...staticTime(),
                extentSource: {
                    url: 'x',
                    startPath: 'extent.temporal.interval.0.0',
                    endPath: 'end',
                    intervalPath: 'summaries.cadence',
                    datesPath: 'summaries.datetime',
                },
            }
            const report = applyExtentSource(time, {
                ...STAC,
                end: 'now - P1D',
            })
            expect(time.dataStartTime).toBe('2020-01-01T00:00:00Z')
            expect(time.dataEndTime).toBe('now - P1D')
            expect(time.interval).toBe('P1M')
            expect(time.dataDates).toEqual(['2020-01', '2020-02'])
            expect(report.applied.sort()).toEqual([
                'dataDates',
                'dataEndTime',
                'dataStartTime',
                'interval',
            ])
            expect(report.skipped).toEqual([])
        })

        test('a finite number is epoch milliseconds, written as ISO', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start', datesPath: 'ds' },
            }
            applyExtentSource(time, { start: 0, ds: [86400000, '2020-03'] })
            expect(time.dataStartTime).toBe('1970-01-01T00:00:00Z')
            expect(time.dataDates).toEqual(['1970-01-02T00:00:00Z', '2020-03'])
        })

        test('a lone scalar for dates becomes a one-entry list', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            applyExtentSource(time, { d: '2020-03' })
            expect(time.dataDates).toEqual(['2020-03'])
        })

        test('unaccepted date entries are dropped, not applied', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            applyExtentSource(time, {
                d: ['2020-01', null, {}, true, '', ['2020-02'], 5],
            })
            expect(time.dataDates).toEqual(['2020-01', '1970-01-01T00:00:00Z'])
        })

        test('a dates path whose entries are all unaccepted falls back', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            const report = applyExtentSource(time, { d: [null, {}] })
            expect(time.dataDates).toEqual(['2000-01-01'])
            expect(report.applied).toEqual([])
            expect(report.skipped).toHaveLength(1)
        })

        test('a blank path leaves its field alone and is not reported', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start', endPath: '  ' },
            }
            const report = applyExtentSource(time, { start: '2020-01-01' })
            expect(time.dataStartTime).toBe('2020-01-01')
            expect(time.dataEndTime).toBe('now')
            expect(time.interval).toBe('P1D')
            expect(report.applied).toEqual(['dataStartTime'])
            expect(report.skipped).toEqual([])
        })

        test.each([
            ['matches nothing', { nope: 1 }, 'start'],
            ['names keys that do not exist', { start: '2020' }, 'nope.start'],
            ['yields null', { start: null }, 'start'],
            ['yields an object', { start: {} }, 'start'],
            ['yields a boolean', { start: true }, 'start'],
            ['yields an empty string', { start: '' }, 'start'],
            ['yields an array', { start: ['2020'] }, 'start'],
            ['yields a non-finite number', { start: Infinity }, 'start'],
        ])('start path that %s falls back and is reported', (_, json, path) => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: path },
            }
            const report = applyExtentSource(time, json)
            expect(time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(report.applied).toEqual([])
            expect(report.skipped).toHaveLength(1)
            expect(report.skipped[0]).toContain(path)
        })

        test('a string containing markup characters is not accepted as a start value', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start' },
            }
            const report = applyExtentSource(time, {
                start: '<img src=x onerror=alert(1)>',
            })
            expect(time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(report.applied).toEqual([])
            expect(report.skipped).toHaveLength(1)
        })

        test.each([
            ['now - P1D'],
            ['now + P5D'],
            ['2020-03'],
            ['2020-03-04T14:30:00+02:00'],
        ])('%s is still accepted as a start value', (value) => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start' },
            }
            applyExtentSource(time, { start: value })
            expect(time.dataStartTime).toBe(value)
        })

        test('P1M is still accepted as an interval value', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', intervalPath: 'i' },
            }
            applyExtentSource(time, { i: 'P1M' })
            expect(time.interval).toBe('P1M')
        })

        test('a dates entry containing markup characters is dropped', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            const report = applyExtentSource(time, {
                d: ['2020-01', '<script>1</script>'],
            })
            expect(time.dataDates).toEqual(['2020-01'])
            expect(report.applied).toEqual(['dataDates'])
        })

        test('an interval must be a string', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', intervalPath: 'i' },
            }
            const report = applyExtentSource(time, { i: 7 })
            expect(time.interval).toBe('P1D')
            expect(report.skipped).toHaveLength(1)
        })

        test('a path that yields an array is not accepted for start', () => {
            const time = {
                ...staticTime(),
                extentSource: {
                    url: 'x',
                    startPath: 'extent.temporal.interval',
                },
            }
            applyExtentSource(time, STAC)
            expect(time.dataStartTime).toBe('2000-01-01T00:00:00Z')
        })

        test.each([[null], ['text'], [42], [undefined]])(
            'a non-object response %s applies nothing',
            (json) => {
                const time = {
                    ...staticTime(),
                    extentSource: { url: 'x', startPath: 'start' },
                }
                const report = applyExtentSource(time, json)
                expect(time).toMatchObject(staticTime())
                expect(report.applied).toEqual([])
                expect(report.skipped).toHaveLength(1)
            }
        )

        test('an array root is addressed by index', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: '0.d' },
            }
            const report = applyExtentSource(time, [{ d: '2020-01' }])
            expect(time.dataStartTime).toBe('2020-01')
            expect(report.applied).toEqual(['dataStartTime'])
        })

        test('no extentSource applies nothing and reports nothing', () => {
            const time = staticTime()
            const report = applyExtentSource(time, STAC)
            expect(time).toEqual(staticTime())
            expect(report).toEqual({ applied: [], skipped: [] })
        })
    })

    describe('fetchLayerExtentSource', () => {
        const jsonResponse = (body, status = 200) => ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        })
        const layerWith = (extentSource, rest = {}) => ({
            name: 'uuid-1',
            display_name: 'CO2 Monthly',
            time: {
                enabled: true,
                dataStartTime: '2000-01-01T00:00:00Z',
                dataEndTime: 'now',
                extentSource,
                ...rest,
            },
        })

        afterEach(() => {
            vi.restoreAllMocks()
        })

        test('a successful fetch applies the mapped values', async () => {
            const fetchImpl = vi.fn(async () =>
                jsonResponse({ start: '2020-01-01', end: '2021-01-01' })
            )
            const layer = layerWith({
                url: 'https://api.example/extent',
                startPath: 'start',
                endPath: 'end',
            })
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example/extent')
            expect(layer.time.dataStartTime).toBe('2020-01-01')
            expect(layer.time.dataEndTime).toBe('2021-01-01')
            expect(report.applied.sort()).toEqual(['dataEndTime', 'dataStartTime'])
        })

        test('a partial result warns once and keeps the rest static', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            const layer = layerWith({
                url: 'u',
                startPath: 'start',
                endPath: 'missing',
            })
            await fetchLayerExtentSource(layer, { fetchImpl })
            expect(layer.time.dataStartTime).toBe('2020')
            expect(layer.time.dataEndTime).toBe('now')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('CO2 Monthly')
            expect(warn.mock.calls[0][0]).toContain('missing')
        })

        test('a fully applied result does not warn', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            await fetchLayerExtentSource(
                layerWith({ url: 'u', startPath: 'start' }),
                { fetchImpl }
            )
            expect(warn).not.toHaveBeenCalled()
        })

        test.each([
            ['a network error', vi.fn(async () => { throw new TypeError('Failed to fetch') })],
            ['a non-2xx status', vi.fn(async () => jsonResponse({ start: '2020' }, 404))],
            [
                'a non-JSON body',
                vi.fn(async () => ({
                    ok: true,
                    status: 200,
                    json: async () => { throw new SyntaxError('Unexpected token') },
                })),
            ],
        ])('%s applies nothing, warns once and resolves null', async (_, fetchImpl) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const layer = layerWith({ url: 'u', startPath: 'start' })
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(report).toBeNull()
            expect(layer.time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('CO2 Monthly')
        })

        test('a fetchImpl that throws synchronously resolves null and warns once', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(() => {
                throw new Error('boom')
            })
            const layer = layerWith({ url: 'u', startPath: 'start' })
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(report).toBeNull()
            expect(layer.time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(warn).toHaveBeenCalledTimes(1)
        })

        test('a timeout aborts the request, applies nothing and resolves null', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(
                (_url, init) =>
                    new Promise((_, reject) => {
                        init.signal.addEventListener('abort', () =>
                            reject(new DOMException('Aborted', 'AbortError'))
                        )
                    })
            )
            const layer = layerWith({ url: 'u', startPath: 'start' })
            const report = await fetchLayerExtentSource(layer, {
                fetchImpl,
                timeoutMs: 5,
            })
            expect(report).toBeNull()
            expect(layer.time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toMatch(/timed out/)
        })

        test.each([
            ['a relative URL', 'extent.json', 'Missions/Demo/extent.json'],
            ['a root-relative URL', '/public/extent.json', '/public/extent.json'],
            ['an absolute URL', 'https://api.example/extent', 'https://api.example/extent'],
            ['a scheme-relative URL', '//api.example/extent', '//api.example/extent'],
        ])('%s is prefixed with the mission path only when relative', async (_, url, expected) => {
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            await fetchLayerExtentSource(layerWith({ url, startPath: 'start' }), {
                fetchImpl,
                missionPath: 'Missions/Demo/',
            })
            expect(fetchImpl.mock.calls[0][0]).toBe(expected)
        })

        test('a relative URL is fetched as written without a mission path', async () => {
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            await fetchLayerExtentSource(layerWith({ url: 'extent.json', startPath: 'start' }), {
                fetchImpl,
            })
            expect(fetchImpl.mock.calls[0][0]).toBe('extent.json')
        })

        test.each([
            ['no time block', { name: 'a', display_name: 'A' }],
            ['time disabled', layerWith({ url: 'u', startPath: 's' }, { enabled: false })],
            ['no extentSource', layerWith(undefined)],
            ['blank url', layerWith({ url: '   ', startPath: 's' })],
        ])('%s fetches nothing and resolves null', async (_, layer) => {
            const fetchImpl = vi.fn()
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(report).toBeNull()
            expect(fetchImpl).not.toHaveBeenCalled()
        })

        test('falls back to the layer name when there is no display name', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({}, 500))
            const layer = layerWith({ url: 'u', startPath: 's' })
            delete layer.display_name
            await fetchLayerExtentSource(layer, { fetchImpl })
            expect(warn.mock.calls[0][0]).toContain('uuid-1')
        })
    })
})
