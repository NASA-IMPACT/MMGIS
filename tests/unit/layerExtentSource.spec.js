import { describe, test, expect } from 'vitest'
import { readPath } from '../../src/essence/Basics/TimeControl_/layerExtentSource'

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
})
