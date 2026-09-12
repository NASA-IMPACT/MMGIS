import { describe, test, expect } from 'vitest'
import {
    readPath,
    applyExtentSource,
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
            ['extent.temporal.interval[0][0]', '2020-01-01T00:00:00Z'],
            ['extent.temporal.interval[0][1]', null],
            ['summaries.cadence', 'P1M'],
            ['summaries.datetime', ['2020-01', '2020-02']],
            ['summaries.datetime[*]', ['2020-01', '2020-02']],
            ['$.summaries.cadence', 'P1M'],
            ['$summaries.cadence', 'P1M'],
            [
                'features[*].properties.datetime',
                ['2021-01-01T00:00:00Z', '2021-02-01T00:00:00Z'],
            ],
            ['extent.temporal.interval[*]', [['2020-01-01T00:00:00Z', null]]],
        ])('reads %s', (path, expected) => {
            expect(readPath(STAC, path)).toEqual(expected)
        })

        test.each([
            ['missing.key'],
            ['summaries.datetime[5]'],
            ['summaries.cadence.deeper'],
            ['features[*].nothing'],
        ])('%s matches nothing', (path) => {
            expect(readPath(STAC, path)).toBeUndefined()
        })

        test('[*] on a non-array matches nothing', () => {
            expect(readPath(STAC, 'summaries[*]')).toBeUndefined()
        })

        test('[*] yielding no elements matches nothing', () => {
            expect(readPath({ items: [] }, 'items[*].id')).toBeUndefined()
        })

        test.each([
            ['$..datetime'],
            ["features[?(@.id=='a')]"],
            ["['summaries']"],
            ['summaries..cadence'],
            ['summaries.'],
            ['[0]'],
            [''],
            ['summaries[a]'],
        ])('rejects %s as invalid', (path) => {
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
                    startPath: 'extent.temporal.interval[0][0]',
                    endPath: 'end',
                    intervalPath: 'summaries.cadence',
                    datesPath: 'summaries.datetime[*]',
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
            ['is invalid', { start: '2020' }, '$..start'],
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

        test('an interval must be a string', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', intervalPath: 'i' },
            }
            const report = applyExtentSource(time, { i: 7 })
            expect(time.interval).toBe('P1D')
            expect(report.skipped).toHaveLength(1)
        })

        test('a [*] over nested arrays is not accepted for start', () => {
            const time = {
                ...staticTime(),
                extentSource: {
                    url: 'x',
                    startPath: 'extent.temporal.interval[*]',
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

        test('an array root cannot be addressed: the grammar needs a key first', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: '[*].d' },
            }
            const report = applyExtentSource(time, [{ d: '2020-01' }])
            expect(report.applied).toEqual([])
            const time2 = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: '$[0].d' },
            }
            applyExtentSource(time2, [{ d: '2020-01' }])
            expect(time2.dataStartTime).toBe('2000-01-01T00:00:00Z')
        })

        test('no extentSource applies nothing and reports nothing', () => {
            const time = staticTime()
            const report = applyExtentSource(time, STAC)
            expect(time).toEqual(staticTime())
            expect(report).toEqual({ applied: [], skipped: [] })
        })
    })
})
